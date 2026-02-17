/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma, UnitKind } from "@prisma/client";
import { MONEY_EPS } from "~/utils/money";

type DbLike = {
  $transaction: <T>(fn: (tx: any) => Promise<T>, options?: any) => Promise<T>;
};

// Local helper: keep same behavior as route
const note500 = (s: unknown) =>
  String(s || "")
    .trim()
    .slice(0, 500);

type ClaimType = "OPEN_BALANCE" | "PRICE_BARGAIN" | "OTHER";
const normalizeClaimType = (v: unknown): ClaimType =>
  String(v || "").trim() === "PRICE_BARGAIN"
    ? "PRICE_BARGAIN"
    : "OPEN_BALANCE";

export async function handleSendClearance(args: {
  db: DbLike;
  runId: number;
  actorId: number | null;
  formData: FormData;
}) {
  const { db, runId, actorId, formData } = args;

  const sendReceiptKey = String(formData.get("sendReceiptKey") || "")
    .slice(0, 64)
    .trim();
  const sendKind = String(formData.get("sendKind") || "").trim(); // "PARENT" | "ROAD"
  const requestedIntent = normalizeClaimType(formData.get("sendIntent"));

  if (!sendReceiptKey) {
    throw new Response("Missing sendReceiptKey.", { status: 400 });
  }
  if (sendKind !== "PARENT" && sendKind !== "ROAD") {
    throw new Response("Invalid sendKind.", { status: 400 });
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    async function upsertCaseByReceiptKey(payload: {
      receiptKey: string;
      note?: string;
      frozenTotal: number;
      cashCollected: number;
      customerId: number | null;
      orderId?: number | null;
      runReceiptId?: number | null;
    }) {
      const receiptKey = String(payload.receiptKey || "")
        .slice(0, 64)
        .trim();
      if (!receiptKey) {
        throw new Response("Missing receiptKey for clearance", { status: 400 });
      }
      // Safety: never allow a receiptKey to "move" between runs.
      // (If receiptKey is globally unique, this will never trigger; if it ever does, it's a data integrity alarm.)
      const existing = await tx.clearanceCase.findUnique({
        where: { receiptKey } as any,
        select: { id: true, runId: true, status: true },
      });
      if (existing && Number(existing.runId) !== runId) {
        throw new Response(
          `ReceiptKey already belongs to another run (caseId=${existing.id}).`,
          { status: 409 },
        );
      }

      // 🔒 Governance: do NOT allow re-sending once a case exists (prevents reopening DECIDED cases
      // and prevents mutating cash/message after send).
      if (existing) {
        throw new Response(
          `Clearance already exists for this receipt (caseId=${existing.id}, status=${existing.status}).`,
          { status: 409 },
        );
      }

      const note = (payload.note || "").trim().slice(0, 500) || null;

      // ✅ Create only (since we hard-block if existing)
      return tx.clearanceCase.create({
        data: {
          receiptKey,
          status: "NEEDS_CLEARANCE",
          origin: "RIDER",
          flaggedAt: now,
          ...(actorId ? { flaggedById: actorId } : {}),
          note,
          frozenTotal: new Prisma.Decimal(payload.frozenTotal),
          cashCollected: new Prisma.Decimal(payload.cashCollected),
          runId,
          customerId: payload.customerId ?? null,
          ...(payload.orderId ? { orderId: payload.orderId } : {}),
          ...(payload.runReceiptId
            ? { runReceiptId: payload.runReceiptId }
            : {}),
        } as any,
        select: { id: true },
      });
    }

    async function replaceLatestClaim(payload: {
      caseId: number;
      type?: ClaimType;
    }) {
      // v2.5: keep ONE latest intent snapshot per case
      await tx.clearanceClaim.deleteMany({ where: { caseId: payload.caseId } });
      await tx.clearanceClaim.create({
        data: {
          caseId: payload.caseId,
          type: (payload.type || "OTHER") as any,
        } as any,
      });
    }

    if (sendKind === "PARENT") {
      if (!sendReceiptKey.startsWith("PARENT:")) {
        throw new Response("Invalid parent receiptKey format.", {
          status: 400,
        });
      }
      const parts = sendReceiptKey.split(":");
      if (parts.length !== 2)
        throw new Response("Invalid parent receiptKey.", { status: 400 });
      const orderId = Number(parts[1] || 0) || 0;
      if (!orderId)
        throw new Response("Invalid parent receiptKey.", { status: 400 });

      const o = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          customerId: true,
          customer: {
            select: {
              alias: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          items: {
            select: {
              productId: true,
              name: true,
              qty: true,
              unitKind: true,
              unitPrice: true,
              lineTotal: true,
              baseUnitPrice: true,
              discountAmount: true,
            },
            orderBy: { id: "asc" },
          },
        },
      });
      if (!o)
        throw new Response(`Parent order not found: ${orderId}`, {
          status: 400,
        });

      const frozenTotal = Number(
        (o.items || [])
          .reduce((s, it) => s + Number(it.lineTotal ?? 0), 0)
          .toFixed(2),
      );

      const paidRaw =
        Number(
          String(formData.get("sendCashCollected") || "0").replace(
            /[^0-9.]/g,
            "",
          ),
        ) || 0;
      const paid = Math.max(0, Math.min(frozenTotal, paidRaw));
      const remaining = Math.max(0, Number((frozenTotal - paid).toFixed(2)));
      if (remaining <= MONEY_EPS) {
        throw new Response("No remaining balance; clearance not allowed.", {
          status: 400,
        });
      }

      const msg = note500(formData.get("sendMessage"));
      if (!msg)
        throw new Response("Clearance message required.", { status: 400 });

      const cIntent: ClaimType = requestedIntent;
      if (cIntent === "OPEN_BALANCE" && !o.customerId) {
        throw new Response("OPEN_BALANCE requires customer record.", {
          status: 400,
        });
      }

      const customerName =
        (o.customer?.alias && o.customer.alias.trim()) ||
        [o.customer?.firstName, o.customer?.lastName]
          .filter(Boolean)
          .join(" ") ||
        null;

      const rr = await tx.runReceipt.upsert({
        where: { runId_receiptKey: { runId, receiptKey: sendReceiptKey } },
        create: {
          runId,
          kind: "PARENT",
          receiptKey: sendReceiptKey,
          parentOrderId: orderId,
          customerId: o.customerId ?? null,
          customerName,
          customerPhone: o.customer?.phone ?? null,
          cashCollected: new Prisma.Decimal(paid),
        },
        update: {
          customerId: o.customerId ?? null,
          customerName,
          customerPhone: o.customer?.phone ?? null,
          cashCollected: new Prisma.Decimal(paid),
        },
        select: { id: true },
      });

      const frozenLines = (o.items || [])
        .map((it) => {
          const pid = Number(it.productId ?? 0);
          const qty = Math.max(0, Number(it.qty ?? 0));
          if (!pid || qty <= 0) return null;
          const unitKind = (it.unitKind ?? UnitKind.PACK) as UnitKind;
          const unitPrice = Math.max(0, Number(it.unitPrice ?? 0));
          const lineTotal = Math.max(0, Number(it.lineTotal ?? 0));
          const baseUnitPrice = Math.max(
            0,
            Number((it as any).baseUnitPrice ?? 0),
          );
          const discountAmount = Math.max(
            0,
            Number((it as any).discountAmount ?? 0),
          );
          return {
            productId: pid,
            name: String(it.name ?? ""),
            qty,
            unitKind,
            unitPrice,
            lineTotal,
            baseUnitPrice,
            discountAmount,
          };
        })
        .filter(Boolean) as Array<{
        productId: number;
        name: string;
        qty: number;
        unitKind: UnitKind;
        unitPrice: number;
        lineTotal: number;
        baseUnitPrice: number;
        discountAmount: number;
      }>;

      if (!frozenLines.length) {
        throw new Response(`Parent order has no frozen items: ${orderId}`, {
          status: 400,
        });
      }

      await tx.runReceiptLine.deleteMany({
        where: { receiptId: Number(rr.id) },
      });
      await tx.runReceiptLine.createMany({
        data: frozenLines.map((ln) => ({
          receiptId: Number(rr.id),
          productId: ln.productId,
          name: ln.name,
          qty: new Prisma.Decimal(ln.qty) as any,
          unitKind: ln.unitKind as any,
          unitPrice: new Prisma.Decimal(Number(ln.unitPrice).toFixed(2)) as any,
          lineTotal: new Prisma.Decimal(Number(ln.lineTotal).toFixed(2)) as any,
          ...(ln.baseUnitPrice > 0
            ? {
                baseUnitPrice: new Prisma.Decimal(
                  Number(ln.baseUnitPrice).toFixed(2),
                ) as any,
              }
            : {}),
          ...(ln.discountAmount > 0.01
            ? {
                discountAmount: new Prisma.Decimal(
                  Number(ln.discountAmount).toFixed(2),
                ) as any,
              }
            : {}),
        })) as any,
      });

      const opened = await upsertCaseByReceiptKey({
        receiptKey: sendReceiptKey,
        note: msg,
        frozenTotal,
        cashCollected: paid,
        customerId: o.customerId ?? null,
        orderId,
        runReceiptId: Number(rr.id),
      });
      await replaceLatestClaim({ caseId: Number(opened.id), type: cIntent });
    }

    if (sendKind === "ROAD") {
      const roadReceiptJson = String(formData.get("sendRoadReceiptJson") || "");
      if (!roadReceiptJson)
        throw new Response("Missing ROAD receipt payload.", { status: 400 });
      const r = JSON.parse(roadReceiptJson) as any;

      if (
        !r ||
        String(r.key || "")
          .slice(0, 64)
          .trim() !== sendReceiptKey
      ) {
        throw new Response("ROAD receiptKey mismatch.", { status: 400 });
      }

      const lines = Array.isArray(r.lines) ? r.lines : [];
      const usable = lines.filter(
        (ln: any) => (Number(ln.qty) || 0) > 0 && ln.productId != null,
      );
      if (!usable.length)
        throw new Response("ROAD receipt has no lines.", { status: 400 });

      const pids: number[] = Array.from(
        new Set<number>(
          (usable || [])
            .map((ln: any): number => Number(ln?.productId ?? 0))
            .filter((x): x is number => Number.isFinite(x) && x > 0),
        ),
      );

      const prodBase = pids.length
        ? await tx.product.findMany({
            where: { id: { in: pids } },
            select: { id: true, srp: true, price: true },
          })
        : [];
      const baseByPid = new Map<number, { srp: number; price: number }>();
      for (const p of prodBase) {
        const srpNum = Number(p.srp ?? 0);
        const priceNum = Number(p.price ?? 0);
        baseByPid.set(p.id, {
          srp: Number.isFinite(srpNum) ? Math.max(0, srpNum) : 0,
          price: Number.isFinite(priceNum) ? Math.max(0, priceNum) : 0,
        });
      }
      const baseForPack = (pid: number) => {
        const b = baseByPid.get(pid);
        if (!b) return 0;
        return (b.srp > 0 ? b.srp : b.price) || 0;
      };

      const frozenTotal = Number(
        usable
          .reduce(
            (s: number, ln: any) =>
              s + Number(ln.qty || 0) * Number(ln.unitPrice || 0),
            0,
          )
          .toFixed(2),
      );
      const paidRaw = Number(String(r.cashReceived ?? 0)) || 0;
      const paid = Math.max(0, Math.min(frozenTotal, paidRaw));
      const remaining = Math.max(0, Number((frozenTotal - paid).toFixed(2)));
      if (remaining <= MONEY_EPS) {
        throw new Response("No remaining balance; clearance not allowed.", {
          status: 400,
        });
      }

      const msg = note500(r.clearanceReason);
      if (!msg)
        throw new Response("Clearance message required.", { status: 400 });

      const payloadIntent = normalizeClaimType(r.clearanceIntent);
      if (payloadIntent !== requestedIntent) {
        throw new Response("Clearance intent mismatch.", { status: 400 });
      }
      const cIntent: ClaimType = requestedIntent;
      if (cIntent === "OPEN_BALANCE" && !r.customerId) {
        throw new Response("OPEN_BALANCE requires customer record.", {
          status: 400,
        });
      }

      const rr = await tx.runReceipt.upsert({
        where: { runId_receiptKey: { runId, receiptKey: sendReceiptKey } },
        create: {
          runId,
          kind: "ROAD",
          receiptKey: sendReceiptKey,
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          cashCollected: new Prisma.Decimal(paid),
        },
        update: {
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          cashCollected: new Prisma.Decimal(paid),
        },
        select: { id: true },
      });

      await tx.runReceiptLine.deleteMany({
        where: { receiptId: Number(rr.id) },
      });
      await tx.runReceiptLine.createMany({
        data: usable.map((ln: any) => {
          const pid = Number(ln.productId ?? 0);
          const qty = Math.max(0, Number(ln.qty ?? 0));
          const unitPrice = Math.max(0, Number(ln.unitPrice ?? 0));
          const lineTotal = Number((qty * unitPrice).toFixed(2));
          const base = pid > 0 ? baseForPack(pid) : 0;
          const disc = Number(Math.max(0, base - unitPrice).toFixed(2));
          return {
            receiptId: Number(rr.id),
            productId: pid,
            name: String(ln.name ?? ""),
            qty: new Prisma.Decimal(qty) as any,
            unitKind: UnitKind.PACK as any,
            unitPrice: new Prisma.Decimal(unitPrice.toFixed(2)) as any,
            lineTotal: new Prisma.Decimal(lineTotal.toFixed(2)) as any,
            ...(base > 0
              ? { baseUnitPrice: new Prisma.Decimal(base.toFixed(2)) as any }
              : {}),
            ...(disc > 0.01
              ? { discountAmount: new Prisma.Decimal(disc.toFixed(2)) as any }
              : {}),
          };
        }) as any,
      });

      const opened = await upsertCaseByReceiptKey({
        receiptKey: sendReceiptKey,
        note: msg,
        frozenTotal,
        cashCollected: paid,
        customerId: r.customerId ?? null,
        runReceiptId: Number(rr.id),
      });
      await replaceLatestClaim({ caseId: Number(opened.id), type: cIntent });
    }
  });

  return { sendReceiptKey, sendKind };
}

export async function handleMarkVoided(args: {
  db: DbLike;
  runId: number;
  formData: FormData;
}) {
  const { db, runId, formData } = args;

  const receiptKey = String(formData.get("voidReceiptKey") || "")
    .slice(0, 64)
    .trim();
  const reason = String(formData.get("voidReason") || "")
    .trim()
    .slice(0, 200);
  if (!receiptKey)
    throw new Response("Missing voidReceiptKey.", { status: 400 });
  if (!reason) throw new Response("Void reason required.", { status: 400 });

  await db.$transaction(async (tx) => {
    const c = await tx.clearanceCase.findUnique({
      where: { receiptKey } as any,
      select: {
        id: true,
        status: true,
        runId: true,
        decisions: {
          select: { kind: true },
          orderBy: { id: "desc" },
          take: 1,
        },
      },
    });

    if (!c || Number((c as any).runId) !== runId) {
      throw new Response("ClearanceCase not found for this run.", {
        status: 400,
      });
    }

    const last = (c as any)?.decisions?.[0]?.kind;
    if ((c as any).status !== "DECIDED" || last !== "REJECT") {
      throw new Response("VOIDED allowed only after manager REJECT.", {
        status: 400,
      });
    }

    await tx.runReceipt.upsert({
      where: { runId_receiptKey: { runId, receiptKey } },
      create: {
        runId,
        kind: receiptKey.startsWith("PARENT:") ? "PARENT" : "ROAD",
        receiptKey,
        note: `VOIDED: ${reason}`,
      } as any,
      update: { note: `VOIDED: ${reason}` } as any,
    });
  });

  return { receiptKey };
}
