/* eslint-disable @typescript-eslint/no-explicit-any */
// app/routes/runs.$id.rider-checkin.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import * as React from "react";
import { CollapsibleReceipt } from "~/components/rider-checkin/CollapsibleReceipt";
import { StatusPill } from "~/components/rider-checkin/StatusPill";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { CustomerPicker } from "~/components/CustomerPicker";
import { Prisma, UnitKind } from "@prisma/client";
import { loadRunReceiptCashMaps } from "~/services/runReceipts.server";
import { loadRunRecap } from "~/services/runRecap.server";
import { r2 as r2Money, MONEY_EPS } from "~/utils/money";
import {
  handleMarkVoided,
  handleSendClearance,
} from "~/services/riderCheckin.server";
import type { ClearanceCaseStatus } from "@prisma/client";
import {
  ClearanceCard,
  clampCashToTotal,
  getDefaultIntent,
  normalizeClearanceMessage,
  type ClearanceIntentUI,
} from "~/components/rider-checkin/ClearanceCard";

// NOTE (SoT): Parent pricing must be READ from DB-frozen OrderItems only (no live quoting here).

// ROAD RULE (SoT):
// Roadside quick-sales are PACK-ONLY. No retail/tingi unitKind on roadside.
// Enforce PACK at UI payload + server action clamp.

// -------------------------------------------------------
// Types
// -------------------------------------------------------
type StockRow = {
  productId: number;
  name: string;
  loaded: number;
  sold: number; // loader: main POS + snapshot quick sales
  returned: number; // editable
};

type UIUnitKind = "PACK" | "RETAIL";
const PACK: UIUnitKind = "PACK";

// CCS naming convention (v2.5):
// Manager decision snapshot (read-only for rider)
type ClearanceDecisionKindUI =
  | "APPROVE_OPEN_BALANCE"
  | "APPROVE_DISCOUNT_OVERRIDE"
  | "APPROVE_HYBRID"
  | "REJECT";

type ClearanceCaseStatusUI = ClearanceCaseStatus;

// No "NONE" sentinel. When there is no CCS case, keep it `undefined`.
// Operational state (rider/cashier) — NOT a clearance decision
// Persisted on RunReceipt.note as a plain marker (NOT JSON; NOT clearance SoT):
//   "VOIDED: <reason>"
const isVoidedNote = (note: unknown) =>
  typeof note === "string" && note.trim().toUpperCase().startsWith("VOIDED:");

// ✅ tiny helpers to keep TS inference from widening literals into `string`
// Local helper: money rounding (prefer single rounding source)
const r2 = (n: number) => r2Money(Number(n) || 0);

const isApproveDecision = (d: unknown) =>
  d === "APPROVE_OPEN_BALANCE" ||
  d === "APPROVE_DISCOUNT_OVERRIDE" ||
  d === "APPROVE_HYBRID";

// CCS v2.6 SETTLED definition (for gating submit)
const isSettled = (args: {
  remaining: number;
  voided?: boolean;
  decision?: ClearanceDecisionKindUI | null;
}) =>
  args.remaining <= MONEY_EPS ||
  !!args.voided ||
  isApproveDecision(args.decision);

const packLine = (ln: SoldLineUI): SoldLineUI => ({ ...ln, unitKind: PACK });

// UI structure: grouped receipts
type SoldLineUI = {
  key: string;
  productId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  unitKind: UIUnitKind;
};

type SoldReceiptUI = {
  key: string;
  // UI-only (derived): pending iff open ClearanceCase exists
  needsClearance: boolean;
  // NEW: SoT-derived lock once a clearance case exists (pending or decided)
  clearancePending?: boolean;
  // NEW: manager decision hydration
  clearanceCaseStatus?: ClearanceCaseStatusUI;
  clearanceDecision?: ClearanceDecisionKindUI | null;
  // NEW: operational marker (rider/cashier)
  voided?: boolean;
  clearanceReason?: string;
  clearanceIntent?: ClearanceIntentUI;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerObj?: any | null; // for CustomerPicker controlled value
  // ✅ receipt-level cash (one payment per customer receipt)
  cashReceived?: number | null;
  cashInput?: string; // raw string for smooth typing
  lines: SoldLineUI[];
};

type ParentLineUI = {
  key: string;
  productId: number | null;
  name: string;
  qty: number;
  unitKind: UIUnitKind;
  unitPrice: number;
  lineTotal: number;
  baseUnitPrice?: number;
  discountAmount?: number;
};

type ParentReceiptUI = {
  key: string;
  orderId: number;
  customerId: number | null;
  needsClearance: boolean; // derived from CCS open case
  clearancePending?: boolean;
  clearanceCaseStatus?: ClearanceCaseStatusUI;
  clearanceDecision?: ClearanceDecisionKindUI | null;
  voided?: boolean;
  clearanceReason?: string;
  clearanceIntent?: ClearanceIntentUI;
  customerLabel: string;
  lines: ParentLineUI[];
  // orderTotal comes from frozen DB snapshot line totals
  orderTotal: number;
  // optional: actual cash collected for this POS order (snapshot only)
  cashCollected?: number;
  // raw string for smooth typing sa "Cash collected" input
  cashInput?: string;
  // NOTE: clearance UI only appears when remaining balance > 0
};

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: string;
    riderCheckinAt?: string | null;
    riderLabel: string | null;
  };
  rows: StockRow[];
  productOptions: Array<{
    productId: number;
    name: string;
    price: number;
    srp: number;
  }>;
  initialRoadReceipts: SoldReceiptUI[];
  hasSnapshot: boolean;
  parentReceipts: ParentReceiptUI[];
};

// CCS SoT key helpers
const parentReceiptKey = (orderId: number) => `PARENT:${orderId}`;

type ActionData =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: {
        code: "PRICING_MISMATCH";
        orderId: number;
        message: string;
      };
    };

const fmtIso = (d: Date | string | null | undefined) => {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d) : d;
  return Number.isFinite(x.getTime()) ? x.toISOString() : null;
};

// -------------------------------------------------------
// Loader
// -------------------------------------------------------
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN", "EMPLOYEE"]);

  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid id", { status: 400 });

  // NOTE: Rider page should allow continuing a draft (DISPATCHED) or updating already CHECKED_IN before manager remit.
  // Manager "lock/freeze" is on remit.

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      loadoutSnapshot: true,
      riderCheckinSnapshot: true,
      riderCheckinAt: true,
      receipts: {
        select: {
          id: true,
          kind: true,
          receiptKey: true,
          cashCollected: true,
          note: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          parentOrderId: true,
          lines: {
            select: {
              id: true,
              productId: true,
              name: true,
              qty: true,
              unitPrice: true,
              unitKind: true,
              lineTotal: true,
            },
            orderBy: { id: "asc" },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!run) throw new Response("Not found", { status: 404 });

  if (run.status !== "DISPATCHED" && run.status !== "CHECKED_IN") {
    return redirect(`/runs/${id}/summary?note=invalid-status`);
  }

  const rawSnap = run.riderCheckinSnapshot as any;
  // ✅ Canonical cash maps (ROAD expected totals + PARENT cash accumulation)
  const cashMaps = await loadRunReceiptCashMaps(db, id);

  // -------------------------------------------------------
  // CCS: clearance SoT (do NOT read RunReceipt.note JSON)
  // Hydrate BOTH:
  //  - NEEDS_CLEARANCE (pending)  → blocks submit
  //  - DECIDED (decision exists)  → if REJECT, rider must resolve (FULL PAY or VOIDED)
  // -------------------------------------------------------
  const cases = await db.clearanceCase.findMany({
    where: {
      runId: id,
      status: { in: ["NEEDS_CLEARANCE", "DECIDED"] },
    } as any,
    select: {
      id: true,
      receiptKey: true,
      status: true,
      note: true,
      claims: {
        select: { type: true },
        orderBy: { id: "desc" },
        take: 1,
      },
      decisions: {
        select: { kind: true },
        orderBy: { id: "desc" },
        take: 1,
      },
    },
  });

  type CaseHydrate = {
    caseId: number;
    status: "NEEDS_CLEARANCE" | "DECIDED";
    note?: string;
    intent?: ClearanceIntentUI | "UNKNOWN";
    decision?: ClearanceDecisionKindUI | null;
  };

  const caseByReceiptKey = new Map<string, CaseHydrate>();
  for (const c of cases || []) {
    const rk =
      typeof (c as any).receiptKey === "string"
        ? String((c as any).receiptKey).slice(0, 64)
        : "";
    if (!rk) continue;
    const cid = Number((c as any).id);
    const note =
      typeof (c as any).note === "string" ? String((c as any).note) : undefined;
    const rawType = (c as any)?.claims?.[0]?.type;
    const rawDecision = (c as any)?.decisions?.[0]?.kind;
    const intent: CaseHydrate["intent"] =
      rawType === "PRICE_BARGAIN"
        ? "PRICE_BARGAIN"
        : rawType === "OPEN_BALANCE"
        ? "OPEN_BALANCE"
        : rawType
        ? "UNKNOWN"
        : undefined;
    const decision: CaseHydrate["decision"] =
      rawDecision === "REJECT"
        ? "REJECT"
        : rawDecision === "APPROVE_OPEN_BALANCE"
        ? "APPROVE_OPEN_BALANCE"
        : rawDecision === "APPROVE_DISCOUNT_OVERRIDE"
        ? "APPROVE_DISCOUNT_OVERRIDE"
        : rawDecision === "APPROVE_HYBRID"
        ? "APPROVE_HYBRID"
        : null;
    const rawStatus = String((c as any).status || "");
    if (rawStatus !== "NEEDS_CLEARANCE" && rawStatus !== "DECIDED") {
      // CCS SoT: pending/settlement logic only recognizes NEEDS_CLEARANCE | DECIDED
      continue;
    }
    const status: CaseHydrate["status"] = rawStatus;
    caseByReceiptKey.set(rk, { caseId: cid, status, note, intent, decision });
  }

  // ✅ If RunReceipts exist, prefer them over snapshot for UI hydration (ROAD)
  const roadReceiptsRaw: SoldReceiptUI[] = (run.receipts || [])
    .filter((r) => r.kind === "ROAD")
    .map((r): SoldReceiptUI => {
      const cash = Number(r.cashCollected ?? 0);
      const rk = String(r.receiptKey || `ROAD:${r.id}`).slice(0, 64);
      const ccs = caseByReceiptKey.get(rk);
      const pending = ccs?.status === "NEEDS_CLEARANCE";
      const decided = ccs?.status === "DECIDED";
      const needsClearance = pending; // derived
      const clearanceReason = ccs?.note
        ? String(ccs.note).slice(0, 200)
        : undefined;
      const clearanceIntent: ClearanceIntentUI =
        (ccs?.intent as any) ??
        ((r.customerId
          ? "OPEN_BALANCE"
          : "PRICE_BARGAIN") as ClearanceIntentUI);
      return {
        // ✅ keep receiptKey stable so action upserts same receipt instead of churn
        key: rk,
        needsClearance,
        clearancePending: pending,
        // ✅ keep literal union typing (Prisma enum is a string union)
        clearanceCaseStatus: (pending
          ? "NEEDS_CLEARANCE"
          : decided
          ? "DECIDED"
          : undefined) as ClearanceCaseStatusUI | undefined,
        clearanceDecision: ccs?.decision ?? null,
        voided: isVoidedNote(r.note),
        clearanceReason,
        clearanceIntent,
        customerId: r.customerId ?? null,
        customerName: r.customerName ?? null,
        customerPhone: r.customerPhone ?? null,
        customerObj: null, // hydrated below so CustomerPicker shows value after refresh
        cashReceived: cash,
        cashInput: cash ? cash.toFixed(2) : "",
        // ✅ IMPORTANT: force correct TS types (unitKind as UIUnitKind, productId nullable)
        lines: (r.lines || []).map(
          (ln): SoldLineUI => ({
            key: `${String(r.receiptKey || `ROAD:${r.id}`).slice(0, 64)}:ln:${
              ln.id
            }`,
            productId: ln.productId != null ? Number(ln.productId) : null,
            name: String(ln.name ?? ""),
            qty: Number(ln.qty ?? 0),
            unitKind: PACK, // UIUnitKind
            unitPrice: Number(ln.unitPrice ?? 0),
          }),
        ),
      };
    });

  // ✅ Hydrate CustomerPicker value from customerId
  // Without this, refresh will show empty search bar even if receipt has customerId.
  // ✅ Make Prisma-happy: ensure this is strictly number[]
  const roadCustomerIds: number[] = Array.from(
    new Set<number>(
      roadReceiptsRaw
        .map((r) => Number(r.customerId ?? 0))
        .filter((x): x is number => Number.isFinite(x) && x > 0),
    ),
  );

  const roadCustomers = roadCustomerIds.length
    ? await db.customer.findMany({
        where: { id: { in: roadCustomerIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          alias: true,
          phone: true,
        },
      })
    : [];

  const roadCustomerById = new Map(roadCustomers.map((c) => [c.id, c]));

  const roadReceiptsFromDb: SoldReceiptUI[] = roadReceiptsRaw.map(
    (r): SoldReceiptUI => {
      const cid = r.customerId != null ? Number(r.customerId) : 0;
      const c = cid > 0 ? roadCustomerById.get(cid) : null;
      return {
        ...r,
        customerObj: c
          ? {
              id: c.id,
              firstName: c.firstName ?? "",
              lastName: c.lastName ?? "",
              alias: c.alias ?? null,
              phone: c.phone ?? null,
            }
          : null,
        // optional: if DB customer missing but receipt has snapshot name/phone, keep those
        customerName: r.customerName ?? null,
        customerPhone: r.customerPhone ?? null,
      };
    },
  );

  // Parent receipts hydration (PARENT) maps
  const parentPaymentsFromDb = cashMaps.parentCashByOrderId;

  // Snapshot is RETURNS-ONLY (legacy). No cash/credit truth here.

  // Rider Label
  let riderLabel: string | null = null;
  if (run.riderId) {
    const rr = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { alias: true, firstName: true, lastName: true },
    });
    riderLabel =
      rr?.alias?.trim() ||
      [rr?.firstName, rr?.lastName].filter(Boolean).join(" ") ||
      null;
  }

  // 1. LOAD SNAPSHOT (extra load sa dispatch)
  const loadedMap = new Map<number, { name: string; qty: number }>();
  const loadSnap = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[])
    : [];

  for (const row of loadSnap) {
    const pid = Number(row?.productId ?? 0);
    if (!pid) continue;
    const name = String(row?.name ?? `#${pid}`);
    const qty = Math.max(0, Number(row?.qty ?? 0));
    const prev = loadedMap.get(pid);
    loadedMap.set(pid, {
      // keep best-available name
      name: prev?.name && prev.name.trim() ? prev.name : name,
      // ✅ sum qty for same pid
      qty: (prev?.qty || 0) + qty,
    });
  }

  // 2. MAIN SOLD (from delivery orders – parent PAD orders)
  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    include: {
      order: {
        select: {
          id: true,
          isOnCredit: true,
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
              id: true, // 🔴 important: needed for pricing map
              productId: true,
              qty: true,
              name: true,
              unitPrice: true,
              unitKind: true, // ✅ include para available sa TS + unit-aware pricing
              lineTotal: true, // ✅ use frozen lineTotal (canonical after check-in)
              baseUnitPrice: true, // ✅ frozen base for discount display
              discountAmount: true, // ✅ frozen discount per unit for display
            },
          },
        },
      },
    },
  });

  // IMPORTANT:
  // Parent Orders on Rider Check-in should NOT show "Preview vs Frozen" pricing.
  // This page is a snapshot/draft; payable amount must come from OrderItem frozen values,
  // and SRP/Base is only a reference (shown via discount badge).
  //
  // If you still want live repricing, do it in manager remit or a dedicated "reprice" action,
  // not here (to avoid confusing max payment / cash collected logic).
  // ─────────────────────────────────────────────────────────────

  const mainSoldMap = new Map<number, number>();
  const mainSoldNameMap = new Map<number, string>();
  for (const L of links) {
    for (const it of L.order?.items || []) {
      const pid = Number(it.productId ?? 0);
      if (!pid) continue;
      mainSoldMap.set(pid, (mainSoldMap.get(pid) || 0) + Number(it.qty));
      if (!mainSoldNameMap.has(pid) && it.name) {
        mainSoldNameMap.set(pid, it.name);
      }
    }
  }

  // Parent POS orders (for read-only display with prices)
  const parentReceipts: ParentReceiptUI[] = links
    .filter((L) => L.order && (L.order.items?.length || 0) > 0)
    .map((L, idx) => {
      const o = L.order!;
      const c = o.customer;

      let customerLabel = "";
      if (c) {
        customerLabel =
          (c.alias && c.alias.trim()) ||
          [c.firstName, c.lastName].filter(Boolean).join(" ");
      }
      if (!customerLabel && o.customerId) {
        customerLabel = `Customer #${o.customerId}`;
      }
      if (!customerLabel) customerLabel = "Walk-in / Unknown";

      const dbCash = parentPaymentsFromDb.get(o.id);
      const prk = parentReceiptKey(Number(o.id));
      const ccs = caseByReceiptKey.get(prk);
      const pending = ccs?.status === "NEEDS_CLEARANCE";
      const decided = ccs?.status === "DECIDED";
      const needsClearance = pending; // derived
      const clearanceReason = ccs?.note
        ? String(ccs.note).slice(0, 200)
        : undefined;
      const clearanceIntent: ClearanceIntentUI =
        (ccs?.intent as any) ??
        ((o.customerId
          ? "OPEN_BALANCE"
          : "PRICE_BARGAIN") as ClearanceIntentUI);

      const lines: ParentLineUI[] = o.items.map((it, lineIdx) => {
        const pid = it.productId != null ? Number(it.productId) : null;
        const qty = Number(it.qty ?? 0);
        return {
          key: `p-ln-${idx}-${lineIdx}`,
          productId: pid,
          name: it.name ?? "",
          qty,
          unitKind: ((it.unitKind ?? UnitKind.PACK) === UnitKind.RETAIL
            ? "RETAIL"
            : "PACK") as UIUnitKind,
          unitPrice: Number(it.unitPrice ?? 0),
          lineTotal: Number(it.lineTotal ?? 0),
          baseUnitPrice: Number((it as any).baseUnitPrice ?? 0),
          discountAmount: Number((it as any).discountAmount ?? 0),
        };
      });

      // ✅ FROZEN payable total: use order item snapshot totals
      const orderTotalFrozen = Number(
        (o.items || [])
          .reduce((s, it) => s + Number(it.lineTotal ?? 0), 0)
          .toFixed(2),
      );

      return {
        key: `p-rec-${idx}`,
        orderId: o.id,
        customerId: o.customerId ?? null,
        needsClearance,
        clearancePending: pending,
        clearanceCaseStatus: pending
          ? "NEEDS_CLEARANCE"
          : decided
          ? "DECIDED"
          : undefined,
        clearanceDecision: ccs?.decision ?? null,
        voided: isVoidedNote(
          (run.receipts || []).find((x) => x.receiptKey === prk)?.note,
        ),

        clearanceReason,
        clearanceIntent,
        customerLabel,
        lines,
        // ✅ frozen total shown immediately
        orderTotal: orderTotalFrozen,
        cashCollected: dbCash != null ? dbCash : undefined,
        cashInput: dbCash != null ? Number(dbCash).toFixed(2) : "",
      };
    });

  // 3.5 Allowed PIDs = parent PAD products + extra loadout products
  const allowedPids = new Set<number>([
    ...loadedMap.keys(),
    ...mainSoldMap.keys(),
  ]);

  // 4. Snapshot (previous returned) — sold comes from DB ROAD receipts (preferred)
  let existingReturnedRows: Array<{ productId: number; returned: number }> = [];

  if (rawSnap && typeof rawSnap === "object") {
    if (Array.isArray(rawSnap.stockRows)) {
      existingReturnedRows = rawSnap.stockRows
        .map((r: any) => ({
          productId: Number(r?.productId ?? 0),
          returned: Math.max(0, Number(r?.returned ?? 0)),
        }))
        .filter(
          (r: { productId: number; returned: number }) =>
            r.productId > 0 && allowedPids.has(r.productId),
        );
    }
  }

  // 5. Unified PID list (parent PAD + extra)
  const allPids = new Set<number>(allowedPids);

  // 6. Load base product info (name + price) from DB
  const pidList = Array.from(allPids);
  const prodRows = pidList.length
    ? await db.product.findMany({
        where: { id: { in: pidList } },
        select: { id: true, name: true, price: true, srp: true },
      })
    : [];

  // ✅ Unit-aware base inputs
  // - Retail base always from product.price
  // - Pack base always from product.srp (fallback product.price)
  const srpIndex = new Map<number, number>(); // product.srp (may be 0)
  const priceIndex = new Map<number, number>(); // product.price (may be 0)
  const prodNameIndex = new Map<number, string>();
  for (const p of prodRows) {
    const srpNum = Number(p.srp ?? 0);
    const priceNum = Number(p.price ?? 0);
    // ✅ IMPORTANT: treat srp=0 as "not set" and fallback to price
    srpIndex.set(p.id, Number.isFinite(srpNum) ? srpNum : 0);
    priceIndex.set(p.id, Number.isFinite(priceNum) ? priceNum : 0);
    if (p.name) {
      prodNameIndex.set(p.id, p.name);
    }
  }

  // ✅ Single source of truth for recap
  const recap = await loadRunRecap(db, id);

  // For CHECK-IN UI: returned should be editable, so we prefer snapshot row value
  // (but still safe: recap returned already prefers RETURN_IN moves if they exist).
  const returnedOverride = new Map<number, number>();
  for (const r of existingReturnedRows) {
    if (r.productId > 0) returnedOverride.set(r.productId, r.returned);
  }

  const rows: StockRow[] = (recap.recapRows || [])
    .filter((r) => allowedPids.has(r.productId))
    .map((r) => ({
      productId: r.productId,
      name: r.name,
      loaded: r.loaded,
      sold: r.sold,
      returned: returnedOverride.has(r.productId)
        ? (returnedOverride.get(r.productId) as number)
        : r.returned,
    }));

  const productOptions = rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    price: priceIndex.get(r.productId) ?? 0,
    srp: srpIndex.get(r.productId) ?? 0,
  }));

  // ─────────────────────────────────────────────────────────────
  // Customer-specific prices for Quick Sales (pricing engine)
  // ─────────────────────────────────────────────────────────────

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status,
      riderCheckinAt: fmtIso((run as any).riderCheckinAt),
      riderLabel,
    },
    rows,
    productOptions,
    initialRoadReceipts: roadReceiptsFromDb,
    hasSnapshot: !!run.riderCheckinSnapshot,
    parentReceipts,
  });
}

// -------------------------------------------------------
// Action
// -------------------------------------------------------
export async function action({ request, params }: ActionFunctionArgs) {
  // Same guard as loader: only rider/employee/manager/admin can submit
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN", "EMPLOYEE"]);
  const actorId = Number((me as any)?.id ?? (me as any)?.userId ?? 0) || null;

  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid id", { status: 400 });

  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  // PLAN:
  // - "save-draft": persist receipts + returns snapshot WITHOUT changing status
  // - "send-clearance": upsert ClearanceCase+Claim for ONE receiptKey (SoT pending)
  // - "mark-voided": operationally void one receipt (AFTER manager REJECT) — rider/cashier authority
  // - "submit-checkin": persist then set status CHECKED_IN (manager will review on remit)
  if (
    intent !== "save-draft" &&
    intent !== "send-clearance" &&
    intent !== "mark-voided" &&
    intent !== "submit-checkin"
  ) {
    return redirect(`/runs/${id}/rider-checkin`);
  }

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: { id: true, status: true, riderCheckinAt: true },
  });
  if (!run) throw new Response("Not found", { status: 404 });

  if (run.status !== "DISPATCHED" && run.status !== "CHECKED_IN") {
    return redirect(`/runs/${id}/summary?note=invalid-status`);
  }

  const isSubmit = intent === "submit-checkin";
  const isSendClearance = intent === "send-clearance";
  const isMarkVoided = intent === "mark-voided";

  const resolveActionErrorMessage = async (
    e: unknown,
    fallback: string,
  ): Promise<string> => {
    if (e instanceof Response) {
      const msg = (await e.text().catch(() => "")).trim();
      return msg || e.statusText || fallback;
    }
    if (e instanceof Error) {
      return String(e.message || fallback).trim() || fallback;
    }
    const msg = String(e || "").trim();
    return msg || fallback;
  };

  // 🔒 CCS: once CHECKED_IN submitted (riderCheckinAt set), NO edits allowed
  // This must also block send-clearance / mark-voided to avoid post-submit mutation.
  if (run.status === "CHECKED_IN" && run.riderCheckinAt) {
    return redirect(`/runs/${id}/summary?note=checkin-locked`);
  }

  // NOTE: EPS constant is defined at module-level for consistency.

  // -------------------------------------------------------
  // ✅ CCS v2.5: SEND-CLEARANCE must be independent per receipt
  // - Do NOT require full payload
  // - Do NOT delete/update other receipts
  // - Do NOT change run status or snapshots
  // -------------------------------------------------------
  if (isSendClearance) {
    const sendReceiptKey = String(fd.get("sendReceiptKey") || "")
      .slice(0, 64)
      .trim();
    const sendKind = String(fd.get("sendKind") || "").trim(); // "PARENT" | "ROAD"
    if (!sendReceiptKey)
      throw new Response("Missing sendReceiptKey.", { status: 400 });
    if (sendKind !== "PARENT" && sendKind !== "ROAD") {
      throw new Response("Invalid sendKind.", { status: 400 });
    }

    try {
      await handleSendClearance({
        db,
        runId: id,
        actorId,
        formData: fd,
      });
    } catch (e: unknown) {
      const msg = await resolveActionErrorMessage(
        e,
        "Failed to send clearance.",
      );
      return redirect(
        `/runs/${id}/rider-checkin?clearance_error=${encodeURIComponent(
          msg,
        )}&rk=${encodeURIComponent(sendReceiptKey)}`,
      );
    }

    return redirect(
      `/runs/${id}/rider-checkin?clearance_sent=1&rk=${encodeURIComponent(
        sendReceiptKey,
      )}`,
    );
  }

  // -------------------------------------------------------
  // ✅ Operational VOIDED (NOT a clearance decision)
  // Only allowed if manager already REJECTED the case.
  // Persisted on RunReceipt.note as "VOIDED: <reason>" (plain string)
  // -------------------------------------------------------
  if (isMarkVoided) {
    const receiptKey = String(fd.get("voidReceiptKey") || "")
      .slice(0, 64)
      .trim();
    const reason = String(fd.get("voidReason") || "")
      .trim()
      .slice(0, 200);
    if (!receiptKey)
      throw new Response("Missing voidReceiptKey.", { status: 400 });
    if (!reason) throw new Response("Void reason required.", { status: 400 });

    try {
      await handleMarkVoided({
        db,
        runId: id,
        formData: fd,
      });
    } catch (e: unknown) {
      const msg = await resolveActionErrorMessage(e, "Failed to mark VOIDED.");
      return redirect(
        `/runs/${id}/rider-checkin?clearance_error=${encodeURIComponent(
          msg,
        )}&rk=${encodeURIComponent(receiptKey)}`,
      );
    }

    return redirect(
      `/runs/${id}/rider-checkin?voided=1&rk=${encodeURIComponent(receiptKey)}`,
    );
  }

  // From here down: ONLY save-draft / submit-checkin.
  const rowsJson = fd.get("rows");
  const parsedRows = JSON.parse(String(rowsJson || "[]"));

  // -------------------------------------------------------
  // ✅ Unified remaining computation (single SoT for clamp/remaining)
  // -------------------------------------------------------
  const toMoney = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? r2(n) : 0;
  };

  type ParentOrderSnapLite = {
    id: number;
    customerId: number | null;
    items: Array<{ lineTotal: any }>;
  };

  const calcParentPayable = (o: ParentOrderSnapLite, rawPaid: unknown) => {
    const totalFrozen = toMoney(
      (o.items || []).reduce((s, it) => s + Number(it.lineTotal ?? 0), 0),
    );
    const paidRaw = toMoney(rawPaid);
    const paidClamped = r2(Math.max(0, Math.min(totalFrozen, paidRaw)));
    const remaining = r2(Math.max(0, totalFrozen - paidClamped));
    return { totalFrozen, paidClamped, remaining };
  };

  type RoadLineLite = {
    productId: number | null;
    qty: number;
    unitPrice: number;
  };
  const calcRoadPayable = (lines: RoadLineLite[], rawCash: unknown) => {
    const usable = (lines || []).filter(
      (ln) => (Number(ln.qty) || 0) > 0 && ln.productId != null,
    );
    const total = toMoney(
      usable.reduce(
        (s, ln) => s + Number(ln.qty || 0) * Number(ln.unitPrice || 0),
        0,
      ),
    );
    const paidRaw = toMoney(rawCash);
    const paidClamped = r2(Math.max(0, Math.min(total, paidRaw)));
    const remaining = r2(Math.max(0, total - paidClamped));
    return { totalFrozen: total, paidClamped, remaining };
  };

  const normalizeKey = (k: unknown) =>
    String(k || "")
      .slice(0, 64)
      .trim();

  // Parent payment map (raw from payload) — clamp happens via calcParentPayable
  const parentPaidRawByOrderId = new Map<number, number>();
  // (rawParentPayments populated below) but we want the map usable everywhere consistently.

  const stockRows = parsedRows.map((r: any) => ({
    productId: Number(r.productId),
    returned: Math.max(0, Number(r.returned || 0)),
  }));

  // ✅ New: road receipts (receipt-level cash) from UI
  const roadReceiptsJson = fd.get("roadReceiptsJson");
  const roadReceipts = JSON.parse(String(roadReceiptsJson || "[]")) as Array<{
    key: string;
    needsClearance?: boolean;
    clearanceReason?: string;
    clearanceIntent?: "OPEN_BALANCE" | "PRICE_BARGAIN";
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    cashReceived: number | null;
    lines: Array<{
      productId: number | null;
      name: string;
      qty: number;
      unitKind?: "PACK" | "RETAIL";
      unitPrice: number;
    }>;
  }>;

  const parentClearanceJson = fd.get("parentClearanceJson");
  const rawParentClearance = JSON.parse(
    String(parentClearanceJson || "[]"),
  ) as Array<{
    orderId: number;
    // keep optional for backward compatibility (UI may still send it)
    needsClearance?: boolean;
    clearanceReason?: string;
    clearanceIntent?: "OPEN_BALANCE" | "PRICE_BARGAIN";
  }>;

  const parentPaymentsJson = fd.get("parentPaymentsJson");
  const rawParentPayments = JSON.parse(
    String(parentPaymentsJson || "[]"),
  ) as Array<{ orderId: number; cashCollected: number }>;

  // ✅ Pricing SoT: DO NOT accept parent quoted prices from client.
  // Parent orders are already frozen at order creation; downstream must read DB snapshot only.

  // -------------------------------------------------------
  // ✅ Idempotency hard guarantee: validate receiptKey contract BEFORE any DB writes.
  // -------------------------------------------------------
  const keySet = new Set<string>();

  const orderIds = Array.from(
    new Set([
      ...rawParentClearance.map((o) => Number(o.orderId) || 0),
      ...rawParentPayments.map((p) => Number(p.orderId) || 0),
    ]),
  ).filter((x) => x > 0);

  // Build parent raw paid map (used by unified calcParentPayable)
  for (const p of rawParentPayments || []) {
    const oid = Number((p as any).orderId) || 0;
    if (!oid) continue;
    const cashCollected = Number((p as any).cashCollected ?? 0);
    parentPaidRawByOrderId.set(
      oid,
      Number.isFinite(cashCollected) ? cashCollected : 0,
    );
  }

  // reserve PARENT keys
  for (const orderId of orderIds) {
    const k = `PARENT:${orderId}`;
    if (keySet.has(k))
      throw new Response(`Duplicate key in payload: ${k}`, { status: 400 });
    keySet.add(k);
  }

  // validate ROAD keys (and reserved prefix)
  for (const r of roadReceipts || []) {
    const rk = normalizeKey((r as any)?.key);
    if (!rk) throw new Response("ROAD receipt key missing.", { status: 400 });
    if (rk.startsWith("PARENT:")) {
      throw new Response(`Invalid ROAD receiptKey (reserved prefix): ${rk}`, {
        status: 400,
      });
    }
    if (keySet.has(rk)) {
      throw new Response(`Duplicate receiptKey in payload: ${rk}`, {
        status: 400,
      });
    }
    keySet.add(rk);
  }

  const clearanceByOrderId = new Map<
    number,
    { needsClearance: boolean; clearanceReason?: string }
  >(
    rawParentClearance
      .map((x) => ({
        orderId: Number(x.orderId) || 0,
        needsClearance: !!x.needsClearance,
        clearanceReason:
          typeof x.clearanceReason === "string"
            ? x.clearanceReason.slice(0, 200)
            : undefined,
      }))
      .filter((x) => x.orderId > 0)
      .map((x) => [
        x.orderId,
        {
          needsClearance: x.needsClearance,
          clearanceReason: x.clearanceReason,
        },
      ]),
  );

  // ✅ Parent clearance intent map (required by action validations + claim type)
  type ClearanceIntent = "OPEN_BALANCE" | "PRICE_BARGAIN";
  const parentIntentByOrderId = new Map<number, ClearanceIntent>(
    rawParentClearance
      .map((x) => {
        const orderId = Number(x.orderId) || 0;
        const clearanceIntent: ClearanceIntent =
          x.clearanceIntent === "PRICE_BARGAIN"
            ? "PRICE_BARGAIN"
            : "OPEN_BALANCE";
        return { orderId, clearanceIntent };
      })
      .filter((x) => x.orderId > 0)
      .map((x) => [x.orderId, x.clearanceIntent] as const),
  );

  // ✅ Pull parent order header + FROZEN items snapshot from DB (SoT).

  const parentOrderSnap =
    orderIds.length > 0
      ? await db.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            subtotal: true,
            totalBeforeDiscount: true,
            customerId: true,
            isOnCredit: true,
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
                baseUnitPrice: true,
                unitPrice: true,
                discountAmount: true,
                lineTotal: true,
              },
              orderBy: { id: "asc" },
            },
          },
        })
      : [];

  const parentOrderById = new Map(parentOrderSnap.map((o) => [o.id, o]));

  // ✅ Step 2: mismatch guard (DB snapshot integrity) for PARENT orders
  // If header totals disagree with sum of frozen line snapshots, stop check-in save.
  const { getFrozenPricingFromOrder } = await import(
    "~/services/frozenPricing.server"
  );
  for (const o of parentOrderSnap) {
    const pricing = getFrozenPricingFromOrder({
      id: o.id,
      subtotal: o.subtotal ?? null,
      totalBeforeDiscount: o.totalBeforeDiscount ?? null,
      items: (o.items || []).map((it) => ({
        qty: Number(it.qty ?? 0),
        unitKind: (it.unitKind ?? "PACK") as "PACK" | "RETAIL",
        baseUnitPrice: Number(it.baseUnitPrice ?? 0),
        unitPrice: Number(it.unitPrice ?? 0),
        discountAmount: Number(it.discountAmount ?? 0),
        lineTotal: Number(it.lineTotal ?? 0),
      })),
    });
    if (pricing.mismatch) {
      return json<ActionData>(
        {
          ok: false,
          error: {
            code: "PRICING_MISMATCH",
            orderId: o.id,
            message:
              "Pricing snapshot mismatch detected. This parent order likely came from legacy/partial-save data. Please rebuild/repair the order pricing snapshot before continuing.",
          },
        },
        { status: 409 },
      );
    }
  }

  // ✅ Persist to RunReceipt / RunReceiptLine
  await db.$transaction(async (tx) => {
    const pidsToFreeze = new Set<number>();
    // NOTE: do not recompute pricing; only compute totals/remaining for clearance gate.

    // NOTE: Parent orders do not need product base lookup here (they already store baseUnitPrice/discountAmount).
    // Only ROAD quick sales need base lookup for saving baseUnitPrice/discountAmount snapshot.

    for (const r of roadReceipts || []) {
      for (const ln of r.lines || []) {
        const pid = Number(ln.productId ?? 0);
        if (pid > 0) pidsToFreeze.add(pid);
      }
    }

    // ✅ Store BOTH bases so we can compute correct base per unitKind.
    const baseByPid = new Map<number, { price: number; srp: number }>();
    if (pidsToFreeze.size > 0) {
      const prods = await tx.product.findMany({
        where: { id: { in: Array.from(pidsToFreeze) } },
        select: { id: true, srp: true, price: true },
      });
      for (const p of prods) {
        const srpNum = Number(p.srp ?? 0);
        const priceNum = Number(p.price ?? 0);
        baseByPid.set(p.id, {
          price: Number.isFinite(priceNum) ? Math.max(0, priceNum) : 0,
          srp: Number.isFinite(srpNum) ? Math.max(0, srpNum) : 0,
        });
      }
    }

    // ✅ BASE PRICE RESOLVER (Retail=price, Pack=srp fallback price)
    const baseFor = (pid: number, unitKind: "PACK" | "RETAIL") => {
      const b = baseByPid.get(pid);
      if (!b) return 0;
      if (unitKind === "RETAIL") return Math.max(0, Number(b.price || 0));
      const pack = b.srp > 0 ? b.srp : b.price;
      return Math.max(0, Number(pack || 0));
    };
    // Sync receipts instead of wiping everything
    // ✅ HARD RULE: ROAD is PACK-only (server-side clamp)
    const ROAD_UNIT_KIND: UnitKind = UnitKind.PACK;

    const incomingKeys: string[] = [];

    // Parent keys (stable) — use orderIds, not overrides (prevents accidental deletes)
    for (const orderId of orderIds) {
      if (!orderId) continue;
      incomingKeys.push(parentReceiptKey(orderId));
    }

    // Road keys (use UI key; must be <= 64)
    for (const r of roadReceipts || []) {
      const rk = normalizeKey(r.key);
      if (!rk) continue;
      // only keep if may lines
      const lines = (r.lines || []).filter(
        (ln) => (Number(ln.qty) || 0) > 0 && ln.productId != null,
      );
      if (!lines.length) continue;
      incomingKeys.push(rk);
    }

    // Delete receipts that are no longer present (optional but keeps DB clean)
    // Safety: never wipe receipts if client accidentally sends empty payload.
    // Only delete stale receipts when we have at least one incoming key.
    if (incomingKeys.length > 0) {
      // Keep receipts that are linked to active CCS cases to avoid orphaning case refs
      // (receipt removed from payload but case still unresolved/decided for audit).
      const protectedReceiptKeys = (
        await tx.clearanceCase.findMany({
          where: {
            runId: id,
            status: { in: ["NEEDS_CLEARANCE", "DECIDED"] },
          } as any,
          select: { receiptKey: true },
        })
      )
        .map((c) => String((c as any).receiptKey || "").slice(0, 64).trim())
        .filter(Boolean);

      const keepKeys = Array.from(
        new Set<string>([...incomingKeys, ...protectedReceiptKeys]),
      );

      await tx.runReceipt.deleteMany({
        where: {
          runId: id,
          receiptKey: { notIn: keepKeys },
        },
      });
    }

    // Parent receipts (POS orders) => kind PARENT, keyed by orderId
    // ✅ Save header + lines snapshot (for cashier/audit)
    // IMPORTANT: iterate orderIds (not overrides) so missing override doesn't skip persistence.
    for (const orderIdRaw of orderIds) {
      const orderId = Number(orderIdRaw) || 0;
      if (!orderId) continue;

      const o = parentOrderById.get(orderId);
      if (!o) {
        throw new Response(`Parent order not found: ${orderId}`, {
          status: 400,
        });
      }

      // ✅ Unified payable + clamp + remaining (single SoT)
      const { paidClamped: paid, remaining } = calcParentPayable(
        o as any,
        parentPaidRawByOrderId.get(orderId) ?? 0,
      );

      // ✅ Two gates:
      // - PAYMENT gate: remaining > EPS

      // v2.5 SoT: submit-checkin is allowed ONLY if PENDING ClearanceCase exists for any remaining > EPS.
      // UI "needsClearance" checkbox is NOT the source of truth (it's just a helper UX).
      const metaFromUi = clearanceByOrderId.get(orderId);
      const needsClearanceEffective = remaining > MONEY_EPS;

      if (isSubmit && needsClearanceEffective) {
        const msg = String(metaFromUi?.clearanceReason || "").trim();
        if (!msg) {
          throw new Response(
            `Clearance message required for parent order ${orderId}.`,
            { status: 400 },
          );
        }
        const cIntent = parentIntentByOrderId.get(orderId) || "OPEN_BALANCE";
        if (cIntent === "OPEN_BALANCE" && !o.customerId) {
          throw new Response(
            `OPEN_BALANCE requires customer record for parent order ${orderId}.`,
            { status: 400 },
          );
        }
      }

      // Build customer label snapshot (optional)
      const c = o.customer;
      const customerName =
        (c?.alias && c.alias.trim()) ||
        [c?.firstName, c?.lastName].filter(Boolean).join(" ") ||
        null;

      const receiptKeyCCS = parentReceiptKey(orderId);

      // ✅ Build PARENT lines ONLY from DB-frozen OrderItems (SoT)
      const frozenLines = (o.items || [])
        .map((it) => {
          const pid = Number(it.productId ?? 0);
          const qty = Math.max(0, Number(it.qty ?? 0));
          const unitPrice = Math.max(0, Number(it.unitPrice ?? 0));
          // ✅ STRICT: lineTotal must come from DB snapshot (no computed fallback)
          const lineTotal = r2(Number(it.lineTotal ?? 0));
          const baseUnitPrice = Math.max(0, Number(it.baseUnitPrice ?? 0));
          const discountAmount = Math.max(0, Number(it.discountAmount ?? 0));
          const unitKind = (it.unitKind ?? "PACK") as "PACK" | "RETAIL";
          return {
            pid,
            qty,
            unitPrice,
            lineTotal,
            baseUnitPrice,
            discountAmount,
            unitKind,
            name: String(it.name ?? ""),
          };
        })
        .filter((ln) => ln.pid > 0 && ln.qty > 0);

      if (frozenLines.length === 0) {
        throw new Response(`Parent order has no frozen items: ${orderId}`, {
          status: 400,
        });
      }

      const lines = frozenLines.map((ln) => ({
        product: { connect: { id: ln.pid } },
        name: ln.name,
        qty: new Prisma.Decimal(ln.qty),
        unitKind: ln.unitKind as any,
        unitPrice: new Prisma.Decimal(r2(ln.unitPrice).toFixed(2)),
        // ✅ use frozen lineTotal as payable (do NOT recompute)
        lineTotal: new Prisma.Decimal(r2(ln.lineTotal).toFixed(2)),
        ...(ln.baseUnitPrice > 0
          ? {
              baseUnitPrice: new Prisma.Decimal(
                r2(ln.baseUnitPrice).toFixed(2),
              ),
            }
          : {}),
        ...(ln.discountAmount > 0.01
          ? {
              discountAmount: new Prisma.Decimal(
                r2(ln.discountAmount).toFixed(2),
              ),
            }
          : {}),
      }));

      await tx.runReceipt.upsert({
        where: { runId_receiptKey: { runId: id, receiptKey: receiptKeyCCS } },
        create: {
          runId: id,
          kind: "PARENT",
          receiptKey: receiptKeyCCS,
          parentOrderId: orderId,
          customerId: o.customerId ?? null,
          customerName,
          customerPhone: c?.phone ?? null,
          cashCollected: new Prisma.Decimal(Number(paid || 0)),
          // CCS SoT: clearance state is in ClearanceCase/Claim, not receipt.note
          note: null,
          lines: { create: lines },
        },
        update: {
          parentOrderId: orderId,
          customerId: o.customerId ?? null,
          customerName,
          customerPhone: c?.phone ?? null,
          cashCollected: new Prisma.Decimal(Number(paid || 0)),
          note: null,
          lines: {
            deleteMany: {}, // wipe lines of this receipt only
            create: lines,
          },
        },
      });

      // CCS v2.5: submit-checkin MUST NOT create cases.
      // Gate is enforced later via openSet check (PENDING SoT).
    }

    // Road receipts (quick sales) => kind ROAD
    for (let i = 0; i < (roadReceipts || []).length; i++) {
      const r = roadReceipts[i];
      const lines = (r.lines || []).filter(
        (ln) => (Number(ln.qty) || 0) > 0 && ln.productId != null,
      );
      if (!lines.length) continue;

      const rk = normalizeKey(r.key || `ROAD:${i + 1}`);
      const cash = Number(r.cashReceived ?? 0);

      // ✅ Unified payable + clamp + remaining (single SoT)
      const { paidClamped: paid, remaining } = calcRoadPayable(
        lines as any,
        Number.isFinite(cash) ? cash : 0,
      );
      const needsClearanceEffective = remaining > MONEY_EPS;

      const reason =
        typeof r.clearanceReason === "string"
          ? r.clearanceReason.slice(0, 200)
          : undefined;
      const cIntent =
        r.clearanceIntent === "PRICE_BARGAIN"
          ? "PRICE_BARGAIN"
          : "OPEN_BALANCE";

      // v2.5: checkbox is not SoT; allow submit only if PENDING SoT exists (enforced later).

      if (isSubmit && needsClearanceEffective) {
        const msg = String(reason || "").trim();
        if (!msg) {
          throw new Response(
            `Clearance message required for quick-sale receipt ${rk}.`,
            { status: 400 },
          );
        }
        if (cIntent === "OPEN_BALANCE" && !r.customerId) {
          throw new Response(
            `OPEN_BALANCE requires customer record for quick-sale receipt ${rk}.`,
            { status: 400 },
          );
        }
      }
      await tx.runReceipt.upsert({
        where: { runId_receiptKey: { runId: id, receiptKey: rk } },
        create: {
          runId: id,
          kind: "ROAD",
          receiptKey: rk,
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          cashCollected: new Prisma.Decimal(paid > 0 ? paid : 0),
          note: null,
          lines: {
            create: lines.map((ln) => ({
              // ✅ productId guaranteed by filter above
              product: { connect: { id: Number(ln.productId) } },
              name: String(ln.name ?? ""),
              qty: new Prisma.Decimal(Number(ln.qty || 0)),
              unitKind: ROAD_UNIT_KIND,
              unitPrice: new Prisma.Decimal(Number(ln.unitPrice || 0)),
              lineTotal: new Prisma.Decimal(
                Number(
                  (Number(ln.qty || 0) * Number(ln.unitPrice || 0)).toFixed(2),
                ),
              ),
              ...(() => {
                const pid = Number(ln.productId ?? 0);
                const base = pid > 0 ? baseFor(pid, "PACK") : 0; // ✅ ROAD base=PACK
                return base > 0
                  ? { baseUnitPrice: new Prisma.Decimal(base) }
                  : {};
              })(),
              ...(() => {
                const pid = Number(ln.productId ?? 0);
                const base = pid > 0 ? baseFor(pid, "PACK") : 0; // ✅ ROAD base=PACK
                const up = Number(ln.unitPrice || 0);
                const disc = r2(Math.max(0, base - up));
                return disc > 0.01
                  ? { discountAmount: new Prisma.Decimal(disc) }
                  : {};
              })(),
            })),
          },
        },
        update: {
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          cashCollected: new Prisma.Decimal(paid > 0 ? paid : 0),
          note: null,
          lines: {
            deleteMany: {},
            create: lines.map((ln) => ({
              // ✅ productId guaranteed by filter above
              product: { connect: { id: Number(ln.productId) } },
              name: String(ln.name ?? ""),
              qty: new Prisma.Decimal(Number(ln.qty || 0)),
              unitKind: ROAD_UNIT_KIND,
              unitPrice: new Prisma.Decimal(Number(ln.unitPrice || 0)),
              lineTotal: new Prisma.Decimal(
                Number(
                  (Number(ln.qty || 0) * Number(ln.unitPrice || 0)).toFixed(2),
                ),
              ),
              ...(() => {
                const pid = Number(ln.productId ?? 0);
                const base = pid > 0 ? baseFor(pid, "PACK") : 0; // ✅ ROAD base=PACK
                return base > 0
                  ? { baseUnitPrice: new Prisma.Decimal(base) }
                  : {};
              })(),
              ...(() => {
                const pid = Number(ln.productId ?? 0);
                const base = pid > 0 ? baseFor(pid, "PACK") : 0; // ✅ ROAD base=PACK
                const up = Number(ln.unitPrice || 0);
                const disc = r2(Math.max(0, base - up));
                return disc > 0.01
                  ? { discountAmount: new Prisma.Decimal(disc) }
                  : {};
              })(),
            })),
          },
        },
      });

      // CCS v2.5: submit-checkin MUST NOT create cases (ROAD).
    }

    // keep snapshot for returns + UI recap (optional)
    // ✅ submit-checkin gate (UPDATED per analogy):
    // Submit is allowed ONLY when:
    //  - NO receipt is pending clearance (NEEDS_CLEARANCE), AND
    //  - Any remaining > EPS is "SETTLED" (approved decision OR voided OR fully paid)
    // This enforces: "kapag may for clearance na isa, bawal i-submit kahit yung fully paid"
    if (isSubmit) {
      const receiptKeysToCheck: string[] = [];
      for (const orderId of orderIds)
        receiptKeysToCheck.push(parentReceiptKey(orderId));
      for (const r of roadReceipts || [])
        receiptKeysToCheck.push(
          String(r.key || "")
            .slice(0, 64)
            .trim(),
        );

      // CCS v2.7 hard gate (run-level):
      // if ANY pending case exists for the run, submit must be blocked.
      // This prevents payload-scoped misses and ensures check-in gate is primary.
      const pendingCasesForRun = await tx.clearanceCase.findMany({
        where: {
          runId: id,
          status: "NEEDS_CLEARANCE",
        } as any,
        select: { receiptKey: true },
      });
      if (pendingCasesForRun.length > 0) {
        const pendingKeys = pendingCasesForRun
          .map((c) => String((c as any).receiptKey || "").slice(0, 64))
          .filter(Boolean);
        throw new Response(
          `Submit blocked: may PENDING clearance pa (${pendingKeys
            .slice(0, 3)
            .join(", ")}${pendingKeys.length > 3 ? "…" : ""}).`,
          { status: 400 },
        );
      }

      const cases = await tx.clearanceCase.findMany({
        where: {
          runId: id,
          receiptKey: { in: receiptKeysToCheck },
          status: { in: ["NEEDS_CLEARANCE", "DECIDED"] },
        } as any,
        select: {
          receiptKey: true,
          status: true,
          decisions: {
            select: { kind: true },
            orderBy: { id: "desc" },
            take: 1,
          },
        },
      });

      const pendingSet = new Set<string>();
      const caseByKey = new Map<
        string,
        {
          status: "NEEDS_CLEARANCE" | "DECIDED";
          decision: ClearanceDecisionKindUI | null;
        }
      >();
      for (const c of cases || []) {
        const rk = String((c as any).receiptKey || "").slice(0, 64);
        if (!rk) continue;
        const rawStatus = String((c as any).status || "");
        if (rawStatus !== "NEEDS_CLEARANCE" && rawStatus !== "DECIDED") {
          continue;
        }
        const status: "NEEDS_CLEARANCE" | "DECIDED" = rawStatus;
        const last = (c as any)?.decisions?.[0]?.kind;
        const decision: ClearanceDecisionKindUI | null =
          last === "REJECT"
            ? "REJECT"
            : last === "APPROVE_OPEN_BALANCE"
            ? "APPROVE_OPEN_BALANCE"
            : last === "APPROVE_DISCOUNT_OVERRIDE"
            ? "APPROVE_DISCOUNT_OVERRIDE"
            : last === "APPROVE_HYBRID"
            ? "APPROVE_HYBRID"
            : null;

        caseByKey.set(rk, { status, decision });
        if (status === "NEEDS_CLEARANCE") pendingSet.add(rk);
      }

      // 1) HARD BLOCK: any pending clearance blocks the whole run submit
      if (pendingSet.size > 0) {
        throw new Response(
          `Submit blocked: may PENDING clearance pa (${Array.from(pendingSet)
            .slice(0, 3)
            .join(", ")}${pendingSet.size > 3 ? "…" : ""}).`,
          { status: 400 },
        );
      }

      // Memoized VOIDED lookup (only used when needed)
      const voidedMemo = new Map<string, boolean>();
      const isVoidedForKey = async (rk: string) => {
        if (voidedMemo.has(rk)) return voidedMemo.get(rk) as boolean;
        const rr = await tx.runReceipt.findUnique({
          where: { runId_receiptKey: { runId: id, receiptKey: rk } },
          select: { note: true },
        });
        const v = isVoidedNote(rr?.note);
        voidedMemo.set(rk, v);
        return v;
      };

      // parent remaining check
      for (const orderId of orderIds) {
        const o = parentOrderById.get(orderId);
        if (!o) continue;
        const { remaining } = calcParentPayable(
          o as any,
          parentPaidRawByOrderId.get(orderId) ?? 0,
        );
        if (remaining > MONEY_EPS) {
          const rk = parentReceiptKey(orderId);
          const c = caseByKey.get(rk);
          // remaining exists, but no pending allowed at submit.
          // Therefore it MUST be "SETTLED": approved decision OR voided OR fully paid.
          if (!c) {
            throw new Response(
              `Submit blocked: ${rk} has remaining balance but no clearance decision exists.`,
              { status: 400 },
            );
          }
          const voided = await isVoidedForKey(rk);
          const settled = isSettled({
            remaining,
            voided,
            decision: c.decision ?? null,
          });
          if (!settled) {
            if (c.decision === "REJECT") {
              throw new Response(
                `Submit blocked: manager REJECTED ${rk}. Resolve first: collect full payment OR mark as VOIDED.`,
                { status: 400 },
              );
            }
            throw new Response(
              `Submit blocked: ${rk} has remaining balance but is not settled (no approval / not voided).`,
              { status: 400 },
            );
          }
        }
      }

      // road remaining check
      for (const r of roadReceipts || []) {
        const rk = String(r.key || "")
          .slice(0, 64)
          .trim();
        if (!rk) continue;
        const lines = (r.lines || []).filter(
          (ln) => (Number(ln.qty) || 0) > 0 && ln.productId != null,
        );
        if (!lines.length) continue;
        const { remaining } = calcRoadPayable(
          lines as any,
          Number(r.cashReceived ?? 0),
        );
        if (remaining > MONEY_EPS) {
          const c = caseByKey.get(rk);
          if (!c) {
            throw new Response(
              `Submit blocked: ${rk} has remaining balance but no clearance decision exists.`,
              { status: 400 },
            );
          }
          const voided = await isVoidedForKey(rk);
          const settled = isSettled({
            remaining,
            voided,
            decision: c.decision ?? null,
          });
          if (!settled) {
            if (c.decision === "REJECT") {
              throw new Response(
                `Submit blocked: manager REJECTED ${rk}. Resolve first: collect full payment OR mark as VOIDED.`,
                { status: 400 },
              );
            }
            throw new Response(
              `Submit blocked: ${rk} has remaining balance but is not settled (no approval / not voided).`,
              { status: 400 },
            );
          }
        }
      }
    }

    await tx.deliveryRun.update({
      where: { id },
      data: {
        // ✅ Draft does NOT change status.
        // ✅ Submit moves run to CHECKED_IN for manager remit.
        status: isSubmit ? "CHECKED_IN" : run.status,
        ...(isSubmit ? { riderCheckinAt: new Date() } : {}),
        // Snapshot is RETURNS-ONLY (legacy)
        riderCheckinSnapshot: { stockRows } as any,
      },
    });
  });

  // Redirect behavior:
  // - Draft: back to rider-checkin w/ saved flag
  // - Submit: go to summary (manager will remit next)
  return isSubmit
    ? redirect(`/runs/${id}/summary?checkin=1`)
    : redirect(`/runs/${id}/rider-checkin?saved=1`);
}

// -------------------------------------------------------
// PAGE
// -------------------------------------------------------
export default function RiderCheckinPage() {
  const {
    run,
    rows,
    productOptions,
    initialRoadReceipts,
    hasSnapshot,
    parentReceipts,
  } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const locked = run.status === "CHECKED_IN" && !!run.riderCheckinAt;

  const [openReceipt, setOpenReceipt] = React.useState<Record<string, boolean>>(
    {},
  );

  const isReceiptOpen = React.useCallback(
    (k: string, fallback: boolean) => {
      if (Object.prototype.hasOwnProperty.call(openReceipt, k))
        return !!openReceipt[k];
      return fallback;
    },
    [openReceipt],
  );

  const toggleReceiptOpen = React.useCallback((k: string) => {
    setOpenReceipt((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  // NEW: once a receipt has a clearance case status (pending/decided), keep it read-only.
  const isReceiptLocked = React.useCallback(
    (hasCaseStatus?: boolean) => locked || !!hasCaseStatus,
    [locked],
  );

  const saved = searchParams.get("saved") === "1";
  const clearanceError = searchParams.get("clearance_error");

  const [parentReceiptsState, setParentReceiptsState] =
    React.useState(parentReceipts);

  const remainingForParent = React.useCallback((rec: ParentReceiptUI) => {
    const total = Number(rec.orderTotal || 0);
    const cash = Number(rec.cashCollected || 0);
    return Math.max(0, Number((total - cash).toFixed(2)));
  }, []);

  // ✅ Fix race/timing bug: make "rows" payload controlled (no DOM mutation).
  const [stockRowsState, setStockRowsState] = React.useState<
    Array<{ productId: number; returned: number }>
  >(() =>
    rows.map((r) => ({
      productId: r.productId,
      returned: Number(r.returned ?? 0),
    })),
  );

  // If the loader rows change (different run / refresh), resync the payload.
  React.useEffect(() => {
    setStockRowsState(
      rows.map((r) => ({
        productId: r.productId,
        returned: Number(r.returned ?? 0),
      })),
    );
  }, [rows]);

  // ✅ Unit-aware base per product (Retail=price, Pack=srp fallback price)
  const baseByProductId = React.useMemo(() => {
    const m = new Map<number, { price: number; srp: number }>();
    for (const p of productOptions) {
      const price = Number(p.price ?? 0);
      const srp = Number(p.srp ?? 0);
      m.set(p.productId, {
        price: Number.isFinite(price) ? Math.max(0, price) : 0,
        srp: Number.isFinite(srp) ? Math.max(0, srp) : 0,
      });
    }
    return m;
  }, [productOptions]);

  const getBaseFor = React.useCallback(
    (pid: number | null, unitKind: "PACK" | "RETAIL" = "PACK") => {
      if (!pid) return 0;
      const b = baseByProductId.get(pid);
      if (!b) return 0;
      if (unitKind === "RETAIL") return b.price || 0;
      // PACK
      return (b.srp > 0 ? b.srp : b.price) || 0;
    },
    [baseByProductId],
  );

  const allowedPids = React.useMemo(
    () => new Set(productOptions.map((p) => p.productId)),
    [productOptions],
  );

  // (removed) allPidsForCart — pricing is server-quoted now
  const peso = React.useCallback(
    (n: number) =>
      new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
      }).format(n),
    [],
  );

  const summaryParent = React.useCallback(
    (rec: ParentReceiptUI) => {
      const rem = remainingForParent(rec);

      // prefer cashInput (typed) → else cashCollected → else 0
      const rawCash = rec.cashInput ?? rec.cashCollected ?? 0;
      const cleaned = String(rawCash).replace(/[^0-9.]/g, "");
      const cashNum =
        cleaned.trim() === "" ? 0 : Number.parseFloat(cleaned || "0");
      const cash = Number.isFinite(cashNum) ? cashNum : 0;

      if (rem > MONEY_EPS) {
        return (
          <span className="font-mono">
            Remaining <span className="font-semibold">{peso(rem)}</span>
          </span>
        );
      }

      return (
        <span className="text-emerald-700">
          Fully paid
          <span className="ml-1 text-slate-500">
            • Cash:{" "}
            <span className="font-mono font-semibold">{peso(cash)}</span>
          </span>
        </span>
      );
    },
    [peso, remainingForParent],
  );

  const summaryQuick = React.useCallback(
    (total: number, remaining: number, cash: number) => {
      if (total <= 0) {
        return <span className="text-slate-500">No items yet</span>;
      }

      if (remaining > MONEY_EPS) {
        return (
          <span className="font-mono">
            Remaining <span className="font-semibold">{peso(remaining)}</span>
          </span>
        );
      }

      return (
        <span className="text-emerald-700">
          Fully paid
          <span className="ml-1 text-slate-500">
            • Cash:{" "}
            <span className="font-mono font-semibold">{peso(cash)}</span>
          </span>
        </span>
      );
    },
    [peso],
  );

  // UI helper: show discount badge
  // NOTE:
  // - For PARENT lines (existing orders), base/discount MUST come from frozen OrderItem snapshot
  // - For ROAD quick-sale lines, we still fall back to getBaseFor (product SRP/price) for display
  const renderDiscountBadgeFrozen = React.useCallback(
    (
      baseUnitPrice: number | null | undefined,
      discountAmount: number | null | undefined,
    ) => {
      const base = Number(baseUnitPrice ?? 0);
      const disc = Number(discountAmount ?? 0);
      if (!Number.isFinite(base) || !Number.isFinite(disc)) return null;
      if (base <= 0 || disc <= 0.01) return null;
      return (
        <div className="mt-0.5 text-[10px] font-medium text-emerald-700">
          Disc: {peso(disc)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">
            (Base {peso(base)})
          </span>
        </div>
      );
    },
    [peso],
  );

  const renderDiscountBadgePreview = React.useCallback(
    (
      productId: number | null | undefined,
      unitPrice: number,
      unitKind: "PACK" | "RETAIL" = "PACK",
    ) => {
      const pid = productId ?? null;
      if (!pid) return null;
      const base = getBaseFor(pid, unitKind) || 0;
      const up = Number(unitPrice || 0);
      if (!base || !up) return null;
      const diff = Number((base - up).toFixed(2));
      if (diff <= 0.01) return null;
      return (
        <div className="mt-0.5 text-[10px] font-medium text-emerald-700">
          Disc: {peso(diff)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">
            (Base {peso(base)})
          </span>
        </div>
      );
    },
    [getBaseFor, peso],
  );

  // quick-sold by pid (from initial ROAD receipts hydration)
  const snapshotQuickSoldByPid = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const rec of initialRoadReceipts || []) {
      for (const ln of rec.lines || []) {
        if (ln.productId == null) continue;
        const pid = ln.productId;
        m.set(pid, (m.get(pid) || 0) + Number(ln.qty || 0));
      }
    }
    return m;
  }, [initialRoadReceipts]);

  // baseSoldByPid = loader.sold - snapshot quick (meaning: main POS only)
  const baseSoldByPid = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) {
      const snap = snapshotQuickSoldByPid.get(r.productId) ?? 0;
      const base = Math.max(0, (r.sold || 0) - snap);
      m.set(r.productId, base);
    }
    return m;
  }, [rows, snapshotQuickSoldByPid]);

  // receipts state (quick sales UI)
  const [receipts, setReceipts] = React.useState<SoldReceiptUI[]>(() =>
    Array.isArray(initialRoadReceipts)
      ? (initialRoadReceipts as SoldReceiptUI[])
      : [],
  );

  // Keep a ref to latest receipts to avoid stale closures during async quote
  const receiptsRef = React.useRef<SoldReceiptUI[]>(receipts);
  React.useEffect(() => {
    receiptsRef.current = receipts;
  }, [receipts]);

  // Which line's product dropdown is currently open (by ln.key)
  const [openProductDropdown, setOpenProductDropdown] = React.useState<
    string | null
  >(null);

  const parseMoney = React.useCallback(
    (s: string | number | null | undefined) => {
      if (s == null) return null;
      const cleaned = String(s).replace(/[^0-9.]/g, "");
      if (cleaned.trim() === "") return null;
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : null;
    },
    [],
  );

  const computeReceiptTotals = React.useCallback(
    (rec: SoldReceiptUI) => {
      const total = rec.lines.reduce((s, ln) => {
        const qty = Number(ln.qty || 0);
        const up = Number(ln.unitPrice || 0);
        return s + qty * up;
      }, 0);

      // defaulting behavior:
      // - Cash tab + blank → assume full cash
      // - Credit tab + blank → assume 0 cash
      let cash = parseMoney(rec.cashInput);
      if (cash == null) {
        cash = total; // default: assume full cash unless rider edits
      }

      cash = Math.max(0, Math.min(total, cash));
      const ar = Math.max(0, Number((total - cash).toFixed(2)));

      return {
        total: Number(total.toFixed(2)),
        cash: Number(cash.toFixed(2)),
        ar,
      };
    },
    [parseMoney],
  );
  // allocateCashAcrossLines removed (we use receipt-level cash now)
  // current quick-sold by pid (based on receipts state – live)
  const currentQuickSoldByPid = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const rec of receipts) {
      for (const ln of rec.lines) {
        if (ln.productId == null) continue;
        const pid = ln.productId;
        m.set(pid, (m.get(pid) || 0) + Number(ln.qty || 0));
      }
    }
    return m;
  }, [receipts]);

  // Remaining stock helper per product (loaded - baseSold - quickSales)
  const remainingStockFor = React.useCallback(
    (pid: number) => {
      const row = rows.find((rr) => rr.productId === pid);
      if (!row) return 0;
      const loaded = row.loaded;
      const base = baseSoldByPid.get(pid) ?? 0;
      const quick = currentQuickSoldByPid.get(pid) ?? 0;
      return loaded - base - quick;
    },
    [rows, baseSoldByPid, currentQuickSoldByPid],
  );

  // Only show products in dropdown na may natitirang stock
  const hasRemainingStock = React.useCallback(
    (pid: number) => remainingStockFor(pid) > 0,
    [remainingStockFor],
  );
  // Global flag: may kahit isang product pa ba na may natitirang stock?
  const hasAnyAvailableStock = React.useMemo(
    () => productOptions.some((p) => hasRemainingStock(p.productId)),
    [productOptions, hasRemainingStock],
  );

  // ✅ Minimal rule: you can add more customers as long as there is stock.
  // Receipts with any clearance case status are locked via isReceiptLocked(hasCaseStatus).
  const addQuickBlockedReason = React.useMemo(() => {
    if (locked) return "Locked after submit.";
    if (!hasAnyAvailableStock) return "No more items available for this run.";
    return null;
  }, [locked, hasAnyAvailableStock]);

  // ✅ for returned: update controlled payload (no document.getElementById)
  function updateReturned(i: number, value: number) {
    setStockRowsState((prev) => {
      if (!prev[i]) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], returned: value };
      return next;
    });
  }

  // helper: display sold for recap = base + current quick
  const displaySold = React.useCallback(
    (pid: number) => {
      const base = baseSoldByPid.get(pid) ?? 0;
      const quick = currentQuickSoldByPid.get(pid) ?? 0;
      return base + quick;
    },
    [baseSoldByPid, currentQuickSoldByPid],
  );

  // Build payload for pricing quote from a receipt snapshot
  const buildQuotePayload = React.useCallback((rec: SoldReceiptUI) => {
    const customerId = rec.customerId ?? null;
    const items = (rec.lines || [])
      .filter((ln) => ln.productId != null && (Number(ln.qty) || 0) > 0)
      .map((ln) => ({
        productId: ln.productId as number,
        qty: Number(ln.qty || 0),
        // ✅ ROAD PACK-ONLY: never send RETAIL to quote-pricing for roadside
        unitKind: "PACK" as const,
      }));
    return { customerId, items };
  }, []);

  // ✅ Server-quoted pricing per receipt (no rules leaked to client)
  // IMPORTANT: accept an optional receipt snapshot to avoid stale state on customer change.
  const quoteReceiptPrices = React.useCallback(
    async (receiptKey: string, receiptSnap?: SoldReceiptUI) => {
      const rec =
        receiptSnap ?? receiptsRef.current.find((r) => r.key === receiptKey);
      if (!rec) return;

      const { customerId, items } = buildQuotePayload(rec);

      if (!items.length) return;

      const res = await fetch("/api/quote-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, items }),
      });

      const data = await res.json().catch(() => null);
      const byPid = new Map<number, number>();
      for (const x of data?.items || []) {
        const pid = Number(x?.productId);
        const up = Number(x?.effectiveUnitPrice);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        if (!Number.isFinite(up)) continue;
        byPid.set(pid, up);
      }

      setReceipts((prev) =>
        prev.map((r) =>
          r.key === receiptKey
            ? {
                ...r,
                lines: r.lines.map((ln) => {
                  if (ln.productId == null) return ln;
                  const quoted = byPid.get(ln.productId);
                  // Map.get can be undefined — enforce number
                  if (quoted == null) return ln;
                  const q = Number(quoted);
                  if (!Number.isFinite(q)) return ln;
                  return { ...ln, unitPrice: q };
                }),
              }
            : r,
        ),
      );
    },
    [buildQuotePayload],
  );

  // UPDATED per analogy:
  // Submit is blocked if:
  //  - ANY receipt is still pending clearance (NEEDS_CLEARANCE), OR
  //  - ANY remaining > EPS is NOT "settled" (approved / voided / fully paid)
  const submitBlockedReason = React.useMemo((): string | null => {
    // 1) pending blocks whole run submit
    for (const pr of parentReceiptsState) {
      if (pr.clearanceCaseStatus === "NEEDS_CLEARANCE")
        return "Pending clearance (Parent).";
    }
    for (const qr of receipts) {
      if (qr.clearanceCaseStatus === "NEEDS_CLEARANCE")
        return "Pending clearance (Quick).";
    }

    // 2) rejected + remaining must be resolved by rider (full pay OR voided)
    for (const pr of parentReceiptsState) {
      const rem = remainingForParent(pr);
      if (rem > MONEY_EPS && pr.clearanceDecision === "REJECT" && !pr.voided) {
        return "Rejected receipt not resolved.";
      }
    }
    for (const qr of receipts) {
      const t = computeReceiptTotals(qr);
      if (t.ar > MONEY_EPS && qr.clearanceDecision === "REJECT" && !qr.voided) {
        return "Rejected receipt not resolved.";
      }
    }
    return null;
  }, [parentReceiptsState, receipts, computeReceiptTotals, remainingForParent]);

  const hasSubmitBlock = !!submitBlockedReason;

  // -------------------------------------------------------
  // Minimal UI: collapsible clearance panels
  // - default collapsed when PENDING (to reduce noise)
  // - can expand manually for details / message / actions
  // -------------------------------------------------------
  const [openClearance, setOpenClearance] = React.useState<
    Record<string, boolean>
  >({});

  const isOpen = React.useCallback(
    (key: string, fallback = false) => {
      if (Object.prototype.hasOwnProperty.call(openClearance, key)) {
        return !!openClearance[key];
      }
      return fallback;
    },
    [openClearance],
  );

  const toggleOpen = React.useCallback((key: string) => {
    setOpenClearance((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // -------------------------------------------------------
  // ✅ Option B: remove hidden-input DOM mutation
  // - useSubmit(FormData) for send-clearance + mark-voided
  // - keeps server action contract same field names
  // -------------------------------------------------------
  const sendClearance = React.useCallback(
    (payload: {
      receiptKey: string; // "PARENT:<orderId>" or ROAD key
      kind: "PARENT" | "ROAD";
      cashCollected: string; // already clamped/validated string
      intent: ClearanceIntentUI;
      message: string;
      roadReceiptJson?: string;
    }) => {
      const fd = new FormData();
      fd.set("intent", "send-clearance");
      fd.set("sendReceiptKey", payload.receiptKey);
      fd.set("sendKind", payload.kind);
      fd.set("sendCashCollected", payload.cashCollected);
      fd.set("sendIntent", String(payload.intent));
      fd.set("sendMessage", String(payload.message ?? ""));
      fd.set("sendRoadReceiptJson", payload.roadReceiptJson ?? "");
      submit(fd, { method: "post" });
    },
    [submit],
  );

  const markVoided = React.useCallback(
    (payload: { receiptKey: string; reason: string }) => {
      const fd = new FormData();
      fd.set("intent", "mark-voided");
      fd.set("voidReceiptKey", payload.receiptKey);
      fd.set("voidReason", payload.reason);
      submit(fd, { method: "post" });
    },
    [submit],
  );

  // ✅ Missing var fix: used by Submit button disable
  // "Unsent" = may remaining > EPS pero wala pang ClearanceCase sa SoT (no status at all).
  // (Pending/Decided are NOT unsent.)
  const hasUnsentClearance = React.useMemo(() => {
    // Parent
    for (const pr of parentReceiptsState) {
      const rem = remainingForParent(pr);
      if (rem > MONEY_EPS) {
        const settled = isSettled({
          remaining: rem,
          voided: !!pr.voided,
          decision: pr.clearanceDecision ?? null,
        });
        if (!settled && pr.clearanceCaseStatus == null) return true;
      }
    }
    // Quick sales
    for (const qr of receipts) {
      const t = computeReceiptTotals(qr);
      if (t.ar > MONEY_EPS) {
        const settled = isSettled({
          remaining: t.ar,
          voided: !!qr.voided,
          decision: qr.clearanceDecision ?? null,
        });
        if (!settled && qr.clearanceCaseStatus == null) return true;
      }
    }
    return false;
  }, [parentReceiptsState, receipts, remainingForParent, computeReceiptTotals]);

  const submitDisabledReason = React.useMemo(() => {
    if (locked) return "Locked after submit.";
    if (hasSubmitBlock) return submitBlockedReason || "Submit blocked.";
    if (hasUnsentClearance)
      return "Some receipts have remaining balance but are not sent for clearance.";
    return null;
  }, [locked, hasSubmitBlock, submitBlockedReason, hasUnsentClearance]);

  // (optional) friendlier tooltip text if you want later
  // const unsentReason = hasUnsentClearance
  //   ? "May remaining balance na hindi pa na-send for clearance."
  //   : null;

  // -------------------------------------------------------
  // Clearance UI (simplified)
  // - HARD RULE: show only when remaining > EPS
  // - No dropdowns: free-text message only
  // -------------------------------------------------------

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <Link
          to={`/runs/${run.id}/summary`}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Back
        </Link>

        <h1 className="mt-4 text-base font-semibold tracking-wide text-slate-800">
          Rider Check-in — {run.runCode}
        </h1>
        <p className="text-sm text-slate-600">
          Rider: {run.riderLabel || "—"} • {run.status}
        </p>

        {run.status === "CHECKED_IN" && run.riderCheckinAt ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Check-in submitted at{" "}
            <span className="font-mono">{run.riderCheckinAt}</span>.{" "}
            {locked
              ? "This page is now read-only."
              : "Edits are not allowed after submit."}
          </div>
        ) : null}

        {saved ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Draft saved.
          </div>
        ) : null}
        {clearanceError ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {clearanceError}
          </div>
        ) : null}

        {actionData &&
        actionData.ok === false &&
        actionData.error?.code === "PRICING_MISMATCH" ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <div className="font-semibold">Pricing mismatch blocked</div>
            <div className="mt-1">
              Parent order ID:{" "}
              <span className="font-mono font-semibold">
                #{actionData.error.orderId}
              </span>
            </div>
            <div className="mt-1 text-rose-700/90">
              {actionData.error.message}
            </div>
            <div className="mt-2 text-[12px] text-rose-700/80">
              Next: open the order and run a repair/backfill (legacy) or
              recompute header totals (partial-save).
            </div>
          </div>
        ) : null}

        <Form
          method="post"
          className="mt-5"
          onSubmit={(e) => {
            if (locked) {
              e.preventDefault();
              return;
            }
            // ✅ Only run guards for FINAL submit-checkin.
            // For save-draft, allow incomplete data.
            const native = e.nativeEvent as any;
            const submitter = native?.submitter as
              | HTMLButtonElement
              | undefined;
            const submitIntent =
              submitter?.getAttribute?.("value") || submitter?.value || "";
            const isFinal = submitIntent === "submit-checkin";
            if (!isFinal) return;
            // 🔒 CCS v2.5 submit guard (updated per analogy)
            if (hasSubmitBlock) {
              e.preventDefault();
              alert(submitBlockedReason || "Submit blocked.");
              return;
            }
          }}
        >
          {/* Hidden: stock rows (only productId + returned) */}
          <input
            id="rows-json"
            name="rows"
            type="hidden"
            value={JSON.stringify(stockRowsState)}
            readOnly
          />

          {/* Stock Recap */}
          <h2 className="text-sm font-medium mb-2">1. Stock Recap</h2>
          <div className="rounded-xl border overflow-x-auto bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Loaded</th>
                  <th className="px-3 py-2 text-right">Sold (auto)</th>
                  <th className="px-3 py-2 text-right">Expected Ret</th>
                  <th className="px-3 py-2 text-right">Returned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const soldNow = displaySold(r.productId);
                  const expectedRet = Math.max(0, r.loaded - soldNow);
                  return (
                    <tr key={r.productId} className="border-t">
                      <td className="px-3 py-2">
                        <span className="text-xs text-slate-400 mr-1">
                          #{r.productId}
                        </span>
                        <span>{r.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{r.loaded}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                        {soldNow}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {expectedRet}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          disabled={locked}
                          value={stockRowsState[i]?.returned ?? 0}
                          onChange={(e) =>
                            updateReturned(
                              i,
                              Math.max(0, Number(e.target.value)),
                            )
                          }
                          className="w-20 border rounded px-1 py-0.5 text-right"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Parent POS Orders (read-only) */}
          {parentReceiptsState.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium mb-2">
                2. Parent Orders (from POS)
              </h2>
              <div className="space-y-3">
                {parentReceiptsState.map((rec) => {
                  const rem = remainingForParent(rec);
                  const pending = !!rec.clearancePending;
                  const hasCaseStatus = !!rec.clearanceCaseStatus;
                  const receiptKey = `PARENT:${rec.orderId}`;
                  const open = isReceiptOpen(
                    receiptKey,
                    saved ? false : !hasCaseStatus,
                  );
                  const showStatus = !open; // ✅ show badges only when collapsed
                  const recLocked = isReceiptLocked(hasCaseStatus);
                  const autoNeeds = rem > MONEY_EPS;
                  const rejected = rec.clearanceDecision === "REJECT";
                  const voided = !!rec.voided;
                  return (
                    <div
                      key={rec.key}
                      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      {/*
                       ✅ UI totals (Parent Orders):
                      - Payable totals come from OrderItem frozen values: ln.unitPrice + ln.lineTotal
                      - Base/SRP is reference only (shown via discount badge)
                   */}

                      <CollapsibleReceipt
                        title={`${rec.customerLabel || "Customer"} • #${
                          rec.orderId
                        }`}
                        subtitle={summaryParent(rec)}
                        pill={
                          showStatus && pending ? (
                            <>
                              <StatusPill
                                status="PENDING"
                                label="PENDING clearance"
                              />
                              <span className="text-[11px] text-slate-500">
                                Sent to manager
                              </span>
                            </>
                          ) : showStatus && rejected ? (
                            <StatusPill status="REJECTED" />
                          ) : showStatus && voided ? (
                            <StatusPill status="VOIDED" />
                          ) : showStatus && hasCaseStatus ? (
                            <>
                              <StatusPill status="INFO" label="DECIDED" />
                              <span className="text-[11px] text-slate-500">
                                Manager decided
                              </span>
                            </>
                          ) : showStatus && autoNeeds ? (
                            <>
                              <StatusPill status="NEEDS_CLEARANCE" />
                              <span className="text-[11px] text-slate-500">
                                Not yet sent
                              </span>
                            </>
                          ) : null
                        }
                        open={open}
                        onToggle={() => toggleReceiptOpen(receiptKey)}
                      >
                        <div
                          className={
                            recLocked
                              ? "pointer-events-none opacity-60 select-none"
                              : ""
                          }
                          title={
                            recLocked
                              ? "Locked by clearance case status"
                              : undefined
                          }
                        >
                          <div className="space-y-1 text-[11px] text-slate-600">
                            {rec.lines.map((ln) => {
                              const unitToShow = Number(ln.unitPrice ?? 0);
                              const lineTotalToShow = Number(ln.lineTotal ?? 0);
                              return (
                                <div
                                  key={ln.key}
                                  className="flex justify-between gap-2"
                                >
                                  <div className="flex-1">
                                    <span className="font-medium">
                                      {ln.name}
                                    </span>
                                    {ln.productId != null && (
                                      <span className="ml-1 text-[10px] text-slate-400">
                                        #{ln.productId}
                                      </span>
                                    )}

                                    {/* ✅ Discount badge (PARENT): strictly frozen snapshot */}
                                    {renderDiscountBadgeFrozen(
                                      ln.baseUnitPrice,
                                      ln.discountAmount,
                                    )}
                                  </div>

                                  <div className="text-right font-mono">
                                    <div>Qty: {ln.qty}</div>

                                    <div>
                                      Price:{" "}
                                      <span className="font-semibold">
                                        {unitToShow > 0
                                          ? peso(unitToShow)
                                          : "—"}
                                      </span>
                                    </div>

                                    <div className="font-semibold">
                                      {lineTotalToShow > 0
                                        ? peso(lineTotalToShow)
                                        : "—"}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {/* ✅ Payment (Parent) — match Quick Sales layout/wording */}
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-0.5">
                              <div>
                                Receipt total:{" "}
                                <span className="font-mono font-semibold text-slate-800">
                                  {rec.orderTotal > 0
                                    ? peso(Number(rec.orderTotal || 0))
                                    : "—"}
                                </span>
                              </div>
                            </div>

                            <label className="flex items-center gap-1">
                              <span className="text-slate-500">
                                Cash received:
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder={Number(
                                  rec.orderTotal || 0,
                                ).toFixed(2)}
                                disabled={recLocked}
                                className="w-24 border rounded px-1 py-0.5 text-right bg-white"
                                value={
                                  rec.cashInput ??
                                  (rec.cashCollected != null
                                    ? rec.cashCollected.toFixed(2)
                                    : Number(rec.orderTotal || 0).toFixed(2))
                                }
                                onChange={(e) => {
                                  const rawStr = e.target.value;
                                  setParentReceiptsState((prev) =>
                                    prev.map((r) =>
                                      r.key === rec.key
                                        ? { ...r, cashInput: rawStr }
                                        : r,
                                    ),
                                  );
                                }}
                                onBlur={(e) => {
                                  const rawStr = e.target.value;
                                  const cleaned = rawStr.replace(
                                    /[^0-9.]/g,
                                    "",
                                  );

                                  // allow blank (madaling mag-delete)
                                  if (cleaned === "") {
                                    setParentReceiptsState((prev) =>
                                      prev.map((r) =>
                                        r.key === rec.key
                                          ? {
                                              ...r,
                                              cashCollected: undefined,
                                              cashInput: "",
                                            }
                                          : r,
                                      ),
                                    );
                                    return;
                                  }

                                  const raw = parseFloat(cleaned);
                                  if (!Number.isFinite(raw) || raw < 0) {
                                    setParentReceiptsState((prev) =>
                                      prev.map((r) =>
                                        r.key === rec.key
                                          ? {
                                              ...r,
                                              cashInput:
                                                r.cashCollected != null
                                                  ? r.cashCollected.toFixed(2)
                                                  : "",
                                            }
                                          : r,
                                      ),
                                    );
                                    return;
                                  }

                                  const total = Number(rec.orderTotal || 0);
                                  const clamped = Math.max(
                                    0,
                                    Math.min(total, raw),
                                  );
                                  const formatted = clamped.toFixed(2);

                                  setParentReceiptsState((prev) =>
                                    prev.map((r) =>
                                      r.key === rec.key
                                        ? {
                                            ...r,
                                            cashCollected: clamped,
                                            cashInput: formatted,
                                          }
                                        : r,
                                    ),
                                  );
                                }}
                              />
                            </label>
                          </div>
                        </div>
                        {/* Clearance (corporate / minimal):
                        - HARD RULE: only show when remaining > EPS
                         - Collapsible to reduce noise (esp. when pending)
                    */}
                        <div className="mt-3 space-y-2">
                          {autoNeeds ? (
                            <ClearanceCard
                              id={`p:${rec.orderId}`}
                              open={isOpen(`p:${rec.orderId}`, !pending)}
                              onToggle={() => toggleOpen(`p:${rec.orderId}`)}
                              busy={busy}
                              pending={pending}
                              locked={recLocked}
                              // ✅ avoid duplicate “Remaining ₱…” inside clearance panel;
                              // recap already shows "Remaining (needs clearance): ₱X"
                              remainingLabel={null}
                              intent={getDefaultIntent(
                                rec.customerId,
                                rec.clearanceIntent,
                              )}
                              intentDisabledOpenBalance={!rec.customerId}
                              message={rec.clearanceReason ?? ""}
                              onIntent={(next) =>
                                setParentReceiptsState((prev) =>
                                  prev.map((r) =>
                                    r.key === rec.key
                                      ? {
                                          ...r,
                                          clearanceIntent: next,
                                          needsClearance: true,
                                        }
                                      : r,
                                  ),
                                )
                              }
                              onMessage={(msg) =>
                                setParentReceiptsState((prev) =>
                                  prev.map((r) =>
                                    r.key === rec.key
                                      ? {
                                          ...r,
                                          needsClearance: true,
                                          clearanceReason:
                                            normalizeClearanceMessage(msg),
                                        }
                                      : r,
                                  ),
                                )
                              }
                              statusNode={
                                pending ? (
                                  <StatusPill status="PENDING" />
                                ) : rejected ? (
                                  <StatusPill status="REJECTED" />
                                ) : voided ? (
                                  <StatusPill status="VOIDED" />
                                ) : hasCaseStatus ? (
                                  <StatusPill status="INFO" label="DECIDED" />
                                ) : (
                                  <StatusPill status="NEEDS_CLEARANCE" />
                                )
                              }
                              noteNode={
                                !hasCaseStatus && !rejected && !voided ? (
                                  <span className="text-[11px] text-slate-500">
                                    Not yet sent
                                  </span>
                                ) : pending ? (
                                  <span className="text-[11px] text-slate-500">
                                    Sent to manager
                                  </span>
                                ) : hasCaseStatus ? (
                                  <span className="text-[11px] text-slate-500">
                                    Manager decided (read-only)
                                  </span>
                                ) : null
                              }
                              onSend={
                                hasCaseStatus
                                  ? undefined
                                  : () => {
                                      const total = Number(rec.orderTotal || 0);
                                      const { clamped } = clampCashToTotal(
                                        total,
                                        rec.cashInput ?? rec.cashCollected ?? "",
                                      );
                                      sendClearance({
                                        receiptKey: `PARENT:${rec.orderId}`,
                                        kind: "PARENT",
                                        cashCollected: clamped.toFixed(2),
                                        intent: getDefaultIntent(
                                          rec.customerId,
                                          rec.clearanceIntent,
                                        ),
                                        message: normalizeClearanceMessage(
                                          String(rec.clearanceReason ?? ""),
                                        ),
                                        roadReceiptJson: "",
                                      });
                                    }
                              }
                              extraNode={
                                rejected && !voided ? (
                                  <div className="mt-2">
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => {
                                        const reason = prompt(
                                          "Reason for VOIDED (required).",
                                        );
                                        if (!reason || !reason.trim()) return;
                                        markVoided({
                                          receiptKey: `PARENT:${rec.orderId}`,
                                          reason: reason.trim().slice(0, 200),
                                        });
                                      }}
                                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      Mark as VOIDED
                                    </button>
                                  </div>
                                ) : null
                              }
                            />
                          ) : null}
                        </div>
                      </CollapsibleReceipt>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quicksale Section */}
          <div className="mt-8">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-medium">
                {parentReceipts.length > 0
                  ? "3. Quick Sales (optional)"
                  : "2. Quick Sales (optional)"}
              </h2>
              <button
                type="button"
                disabled={Boolean(addQuickBlockedReason)}
                onClick={() => {
                  if (addQuickBlockedReason) return;
                  setReceipts((prev) => [
                    ...prev,
                    {
                      // Stable-ish, run-scoped key (avoid uuid churn; known prefix helps debugging)
                      key: `ROAD:${run.id}:${Date.now().toString(
                        36,
                      )}${Math.random().toString(36).slice(2, 6)}`,
                      // CCS: rider can only FLAG; no credit decision here
                      needsClearance: false,
                      clearanceReason: "",
                      customerId: null,
                      customerName: null,
                      customerPhone: null,
                      customerObj: null,
                      cashReceived: null,
                      cashInput: "",
                      lines: [
                        {
                          key: `ln:${Date.now().toString(36)}${Math.random()
                            .toString(36)
                            .slice(2, 6)}`,
                          productId: null,
                          name: "",
                          qty: 0,
                          unitKind: PACK,
                          unitPrice: 0,
                          // cashInput left undefined so UI can auto-default
                          // to full line total for Cash tab.
                        },
                      ],
                    },
                  ]);
                }}
                aria-disabled={addQuickBlockedReason ? "true" : "false"}
                title={addQuickBlockedReason ?? undefined}
                className={`rounded border px-3 py-1 text-xs transition ${
                  addQuickBlockedReason
                    ? "opacity-50 cursor-not-allowed bg-slate-50 text-slate-500 border-slate-300"
                    : "bg-white hover:bg-slate-50 border-slate-300 text-slate-700"
                }`}
              >
                + Add Customer
              </button>
            </div>

            {/* Minimalist: no noisy banner. Only show the small stock note below. */}

            {!hasAnyAvailableStock && (
              <p className="mt-1 text-[11px] text-slate-500">
                All products for this run are fully sold or returned. No more
                quick sales can be added.
              </p>
            )}
            {receipts.map((rec) => {
              // Per-receipt totals para makita ang Cash vs A/R ng Quick Sales
              const receiptTotals = computeReceiptTotals(rec);
              const receiptTotal = receiptTotals.total;
              const receiptCash = receiptTotals.cash;
              const receiptAR = receiptTotals.ar;
              const autoNeeds = receiptAR > MONEY_EPS;
              const pending = !!rec.clearancePending;
              const hasCaseStatus = !!rec.clearanceCaseStatus;
              const recLocked = isReceiptLocked(hasCaseStatus);
              const receiptKey = rec.key; // ROAD key already stable
              const open = isReceiptOpen(
                receiptKey,
                saved ? false : !hasCaseStatus,
              );
              const showStatus = !open; // ✅ show badges only when collapsed

              return (
                <div
                  key={rec.key}
                  className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <CollapsibleReceipt
                    title={rec.customerName ?? "Customer Receipt"}
                    subtitle={summaryQuick(
                      receiptTotal,
                      receiptAR,
                      receiptCash,
                    )}
                    pill={
                      showStatus && pending ? (
                        <>
                          <StatusPill
                            status="PENDING"
                            label="PENDING clearance"
                          />
                          <span className="text-[11px] text-slate-500">
                            Sent to manager
                          </span>
                        </>
                      ) : showStatus &&
                        rec.clearanceDecision === "REJECT" &&
                        !rec.voided ? (
                        <StatusPill status="REJECTED" />
                      ) : showStatus && rec.voided ? (
                        <StatusPill status="VOIDED" />
                      ) : showStatus && hasCaseStatus ? (
                        <>
                          <StatusPill status="INFO" label="DECIDED" />
                          <span className="text-[11px] text-slate-500">
                            Manager decided
                          </span>
                        </>
                      ) : showStatus && autoNeeds ? (
                        <>
                          <StatusPill status="NEEDS_CLEARANCE" />
                          <span className="text-[11px] text-slate-500">
                            Not yet sent
                          </span>
                        </>
                      ) : null
                    }
                    open={open}
                    onToggle={() => toggleReceiptOpen(receiptKey)}
                  >
                    <div
                      className={
                        recLocked
                          ? "pointer-events-none opacity-60 select-none"
                          : ""
                      }
                      title={
                        recLocked ? "Locked by clearance case status" : undefined
                      }
                    >
                      {/* Customer Picker */}
                      <div
                        aria-disabled={locked ? "true" : "false"}
                        className={
                          recLocked ? "pointer-events-none opacity-60" : ""
                        }
                        title={locked ? "Locked after submit" : undefined}
                      >
                        <CustomerPicker
                          value={rec.customerObj}
                          onChange={(val) => {
                            if (recLocked) return;
                            const norm = val
                              ? {
                                  id: val.id,
                                  firstName: val.firstName ?? "",
                                  lastName: val.lastName ?? "",
                                  alias: val.alias ?? null,
                                  phone: val.phone ?? null,
                                }
                              : null;

                            // Build "next" receipt snapshot immediately (avoid stale state / microtask)
                            const nextSnap: SoldReceiptUI = {
                              ...rec,
                              customerObj: norm,
                              customerId: norm?.id ?? null,
                              customerName:
                                norm != null
                                  ? norm.alias ||
                                    [norm.firstName, norm.lastName]
                                      .filter(Boolean)
                                      .join(" ") ||
                                    ""
                                  : rec.customerName,
                              customerPhone: norm?.phone ?? rec.customerPhone,
                              // Reset to base while waiting for quote (avoids stale price)
                              lines: (rec.lines || []).map((ln) =>
                                ln.productId == null
                                  ? ln
                                  : {
                                      ...ln,
                                      // ✅ ROAD PACK-ONLY: base should always be PACK base
                                      unitPrice: getBaseFor(
                                        ln.productId,
                                        "PACK",
                                      ),
                                      // Optional hard clamp on state so UI never drifts:
                                      unitKind: "PACK",
                                    },
                              ),
                            };

                            setReceipts((prev) =>
                              prev.map((r) =>
                                r.key === rec.key ? nextSnap : r,
                              ),
                            );

                            // Quote pricing using the snapshot (customerId already updated)
                            void quoteReceiptPrices(rec.key, nextSnap);
                          }}
                        />
                      </div>

                      {/* Lines */}
                      <div className="mt-3 space-y-2">
                        {rec.lines.map((ln) => {
                          const pid = ln.productId;

                          // compute remaining stock for this line
                          let remainingForLine: number | null = null;
                          if (pid && allowedPids.has(pid)) {
                            // remainingStockFor(pid) already subtracts ALL quick sales,
                            // so add back ln.qty to get capacity for this specific line.
                            const baseRemaining = remainingStockFor(pid);
                            remainingForLine = Math.max(
                              0,
                              baseRemaining + ln.qty,
                            );
                          }

                          const isOutOfStock =
                            remainingForLine !== null && remainingForLine <= 0;

                          // kapag qty = 0 or out-of-stock → price display = 0
                          const effectiveUnitPrice =
                            ln.qty <= 0 || isOutOfStock ? 0 : ln.unitPrice ?? 0;

                          const lineTotal = (ln.qty || 0) * effectiveUnitPrice;

                          const badge = renderDiscountBadgePreview(
                            ln.productId,
                            effectiveUnitPrice,
                            (ln.unitKind ?? "PACK") as any,
                          );

                          return (
                            <div
                              key={ln.key}
                              className={`grid grid-cols-12 gap-3 items-start ${
                                isOutOfStock
                                  ? "bg-amber-50 rounded-md px-2 py-2"
                                  : ""
                              }`}
                            >
                              {/* Product dropdown (limited to current load) */}
                              <div className="col-span-6 relative">
                                <button
                                  type="button"
                                  className={`w-full border rounded px-2 py-1 text-sm flex items-center justify-between ${
                                    isOutOfStock
                                      ? "bg-amber-50 border-amber-300 text-amber-800"
                                      : "bg-white border-slate-300 text-slate-900"
                                  } ${
                                    !hasAnyAvailableStock
                                      ? "bg-slate-100 text-slate-400"
                                      : ""
                                  }`}
                                  disabled={recLocked}
                                  onClick={() =>
                                    setOpenProductDropdown((prev) =>
                                      prev === ln.key ? null : ln.key,
                                    )
                                  }
                                >
                                  <span
                                    className={
                                      ln.productId != null
                                        ? "text-slate-900"
                                        : "text-slate-400"
                                    }
                                  >
                                    {ln.productId != null
                                      ? (() => {
                                          const found = productOptions.find(
                                            (p) => p.productId === ln.productId,
                                          );
                                          return `#${ln.productId} • ${
                                            found?.name ?? ln.name ?? "Unknown"
                                          }`;
                                        })()
                                      : "Select product…"}
                                  </span>
                                  <span className="ml-2 text-xs text-slate-400">
                                    ▾
                                  </span>
                                </button>

                                {/* ✅ Discount badge aligned under product selector */}
                                {badge}

                                {openProductDropdown === ln.key && (
                                  <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-white shadow-lg text-sm">
                                    {(() => {
                                      const availableProducts =
                                        productOptions.filter((p) =>
                                          hasRemainingStock(p.productId),
                                        );

                                      if (availableProducts.length === 0) {
                                        return (
                                          <div className="px-3 py-2 text-center text-[11px] text-slate-500">
                                            🚫 No more items available
                                            <div className="mt-0.5 text-[10px] text-slate-400">
                                              All products for this run are out
                                              of stock.
                                            </div>
                                          </div>
                                        );
                                      }

                                      return availableProducts.map((p) => (
                                        <button
                                          key={p.productId}
                                          type="button"
                                          className="w-full text-left px-2 py-1 hover:bg-indigo-50"
                                          disabled={recLocked}
                                          onClick={() => {
                                            if (recLocked) return;
                                            const pid = p.productId;
                                            const name = p.name;
                                            // ✅ ROAD PACK-ONLY
                                            const unitPriceToUse = getBaseFor(
                                              pid,
                                              "PACK",
                                            );
                                            // ✅ Build next receipt snapshot for accurate quoting
                                            // IMPORTANT: return type must be SoldLineUI for ALL branches
                                            const nextLines: SoldLineUI[] =
                                              rec.lines.map((x): SoldLineUI => {
                                                if (x.key !== ln.key)
                                                  return packLine(x);
                                                const remaining = Math.max(
                                                  0,
                                                  remainingStockFor(pid),
                                                );
                                                return {
                                                  ...x,
                                                  productId: pid,
                                                  name,
                                                  unitPrice: unitPriceToUse,
                                                  unitKind: PACK, // ✅ UIUnitKind (not string)
                                                  qty: remaining > 0 ? 1 : 0,
                                                };
                                              });
                                            const nextSnap: SoldReceiptUI = {
                                              ...rec,
                                              lines: nextLines,
                                            };

                                            setReceipts((prev) =>
                                              prev.map((r) =>
                                                r.key === rec.key
                                                  ? nextSnap
                                                  : r,
                                              ),
                                            );
                                            setOpenProductDropdown(null);
                                            // Quote pricing using snapshot (no stale state)
                                            void quoteReceiptPrices(
                                              rec.key,
                                              nextSnap,
                                            );
                                          }}
                                        >
                                          <span className="text-xs text-slate-400 mr-1">
                                            #{p.productId}
                                          </span>
                                          <span>{p.name}</span>
                                        </button>
                                      ));
                                    })()}
                                  </div>
                                )}
                                {isOutOfStock && (
                                  <div className="mt-1 text-[10px] font-semibold text-amber-700">
                                    Out of stock
                                  </div>
                                )}
                              </div>

                              {/* Qty with guard: loaded - (baseSold + other quick) */}
                              <input
                                className="col-span-2 border rounded px-2 py-1 text-sm text-right"
                                type="number"
                                min={0}
                                disabled={recLocked}
                                value={ln.qty}
                                onChange={(e) => {
                                  if (recLocked) return;
                                  const raw = Math.max(
                                    0,
                                    Number(e.target.value) || 0,
                                  );
                                  setReceipts((prev) => {
                                    const pid = ln.productId;
                                    if (!pid || !allowedPids.has(pid)) {
                                      // Walang load, huwag na i-guard
                                      return prev.map((r) =>
                                        r.key === rec.key
                                          ? {
                                              ...r,
                                              lines: r.lines.map((x) =>
                                                x.key === ln.key
                                                  ? { ...x, qty: raw }
                                                  : x,
                                              ),
                                            }
                                          : r,
                                      );
                                    }

                                    const row = rows.find(
                                      (rr) => rr.productId === pid,
                                    );
                                    if (!row) {
                                      return prev.map((r) =>
                                        r.key === rec.key
                                          ? {
                                              ...r,
                                              lines: r.lines.map((x) =>
                                                x.key === ln.key
                                                  ? { ...x, qty: raw }
                                                  : x,
                                              ),
                                            }
                                          : r,
                                      );
                                    }

                                    const loaded = row.loaded;
                                    const base = baseSoldByPid.get(pid) ?? 0;

                                    // Other quick quantities (all lines except ln)
                                    let otherQuick = 0;
                                    for (const r of prev) {
                                      for (const x of r.lines) {
                                        if (
                                          x.productId === pid &&
                                          x.key !== ln.key
                                        ) {
                                          otherQuick += x.qty;
                                        }
                                      }
                                    }

                                    const maxExtra = Math.max(
                                      0,
                                      loaded - base - otherQuick,
                                    );
                                    const newQty = Math.min(raw, maxExtra);

                                    return prev.map((r) =>
                                      r.key === rec.key
                                        ? {
                                            ...r,
                                            lines: r.lines.map((x) =>
                                              x.key === ln.key
                                                ? { ...x, qty: newQty }
                                                : x,
                                            ),
                                          }
                                        : r,
                                    );
                                  });
                                }}
                              />

                              {/* Price + Remove (inline, responsive) */}
                              <div className="col-span-4">
                                <div className="flex items-center gap-2">
                                  <input
                                    className="flex-1 border rounded px-2 py-1 text-sm text-right bg-slate-50"
                                    type="number"
                                    readOnly
                                    value={effectiveUnitPrice.toFixed(2)}
                                  />

                                  <button
                                    type="button"
                                    title="Remove item"
                                    disabled={recLocked}
                                    className="shrink-0 text-slate-400 hover:text-rose-600"
                                    onClick={() =>
                                      setReceipts((prev) =>
                                        prev
                                          .map((r) =>
                                            r.key === rec.key
                                              ? {
                                                  ...r,
                                                  lines: r.lines.filter(
                                                    (x) => x.key !== ln.key,
                                                  ),
                                                }
                                              : r,
                                          )
                                          .filter((r) => r.lines.length > 0),
                                      )
                                    }
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                              {/* Line total + Cash collected + discount helper */}
                              <div className="col-span-12 flex items-center justify-between text-[11px] text-slate-500">
                                <div>
                                  Total:{" "}
                                  <span className="font-mono font-semibold">
                                    {peso(lineTotal)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          className={`mt-1 text-xs border rounded px-2 py-1 ${
                            !hasAnyAvailableStock
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }`}
                          disabled={recLocked || !hasAnyAvailableStock}
                          onClick={() =>
                            hasAnyAvailableStock &&
                            setReceipts((prev) =>
                              prev.map((r) =>
                                r.key === rec.key
                                  ? {
                                      ...r,
                                      lines: [
                                        ...r.lines,
                                        {
                                          key: `ln:${Date.now().toString(
                                            36,
                                          )}${Math.random()
                                            .toString(36)
                                            .slice(2, 6)}`,
                                          productId: null,
                                          name: "",
                                          qty: 0,
                                          unitKind: "PACK",
                                          unitPrice: 0,
                                        },
                                      ],
                                    }
                                  : r,
                              ),
                            )
                          }
                        >
                          + Add Product
                        </button>
                      </div>
                      {/* ✅ Payment (ONE place only) — put after items */}
                      {receiptTotal > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-0.5">
                              <div>
                                Receipt total:{" "}
                                <span className="font-mono font-semibold text-slate-800">
                                  {peso(receiptTotal)}
                                </span>
                              </div>
                            </div>

                            <label className="flex items-center gap-1">
                              <span className="text-slate-500">
                                Cash received:
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                disabled={recLocked}
                                className="w-24 border rounded px-1 py-0.5 text-right bg-white"
                                placeholder={receiptTotal.toFixed(2)}
                                value={rec.cashInput ?? receiptTotal.toFixed(2)}
                                onChange={(e) => {
                                  const rawStr = e.target.value;
                                  setReceipts((prev) =>
                                    prev.map((r) =>
                                      r.key === rec.key
                                        ? { ...r, cashInput: rawStr }
                                        : r,
                                    ),
                                  );
                                }}
                                onBlur={(e) => {
                                  const t = computeReceiptTotals({
                                    ...rec,
                                    cashInput: e.target.value,
                                  });
                                  setReceipts((prev) =>
                                    prev.map((r) =>
                                      r.key === rec.key
                                        ? {
                                            ...r,
                                            cashReceived: t.cash,
                                            cashInput: t.cash.toFixed(2),
                                          }
                                        : r,
                                    ),
                                  );
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      )}
                      {/* Clearance (quick sale) — moved to bottom */}
                      <div className="mt-3 space-y-2">
                        {autoNeeds ? (
                          <ClearanceCard
                            id={`q:${rec.key}`}
                            open={isOpen(`q:${rec.key}`, !pending)}
                            onToggle={() => toggleOpen(`q:${rec.key}`)}
                            busy={busy}
                            pending={pending}
                            locked={recLocked}
                            // ✅ avoid duplicate “Remaining ₱…” inside clearance panel
                            // recap already shows "Remaining (needs clearance): ₱X"
                            remainingLabel={null}
                            intent={getDefaultIntent(
                              rec.customerId,
                              rec.clearanceIntent,
                            )}
                            intentDisabledOpenBalance={!rec.customerId}
                            message={rec.clearanceReason ?? ""}
                            onIntent={(next) =>
                              setReceipts((prev) =>
                                prev.map((r) =>
                                  r.key === rec.key
                                    ? {
                                        ...r,
                                        clearanceIntent: next,
                                        needsClearance: true,
                                      }
                                    : r,
                                ),
                              )
                            }
                            onMessage={(msg) =>
                              setReceipts((prev) =>
                                prev.map((r) =>
                                  r.key === rec.key
                                    ? {
                                        ...r,
                                        needsClearance: true,
                                        clearanceReason:
                                          normalizeClearanceMessage(msg),
                                      }
                                    : r,
                                ),
                              )
                            }
                            statusNode={
                              pending ? (
                                <StatusPill status="PENDING" />
                              ) : rec.clearanceDecision === "REJECT" &&
                                !rec.voided ? (
                                <StatusPill status="REJECTED" />
                              ) : rec.voided ? (
                                <StatusPill status="VOIDED" />
                              ) : hasCaseStatus ? (
                                <StatusPill status="INFO" label="DECIDED" />
                              ) : (
                                <StatusPill status="NEEDS_CLEARANCE" />
                              )
                            }
                            noteNode={
                              hasCaseStatus ? (
                                <span className="text-[11px] text-slate-500">
                                  Manager decided (read-only)
                                </span>
                              ) : !rec.customerId ? (
                                <span className="text-[11px] text-amber-700">
                                  No customer → OPEN_BALANCE not allowed
                                </span>
                              ) : null
                            }
                            onSend={
                              hasCaseStatus
                                ? undefined
                                : () => {
                                    const totals = computeReceiptTotals(rec);
                                    const intent = getDefaultIntent(
                                      rec.customerId,
                                      rec.clearanceIntent,
                                    );
                                    const msg = normalizeClearanceMessage(
                                      String(rec.clearanceReason ?? ""),
                                    );
                                    const roadPayload = {
                                      key: rec.key,
                                      clearanceIntent: intent as any,
                                      clearanceReason: msg,
                                      customerId: rec.customerId ?? null,
                                      customerName: rec.customerName ?? null,
                                      customerPhone: rec.customerPhone ?? null,
                                      cashReceived: totals.cash,
                                      lines: (rec.lines || [])
                                        .filter(
                                          (ln) =>
                                            (Number(ln.qty) || 0) > 0 &&
                                            ln.productId != null,
                                        )
                                        .map((ln) => ({
                                          productId: ln.productId,
                                          name: ln.name,
                                          qty: Number(ln.qty || 0),
                                          unitPrice: Number(ln.unitPrice || 0),
                                        })),
                                    };
                                    sendClearance({
                                      receiptKey: rec.key,
                                      kind: "ROAD",
                                      cashCollected: String(totals.cash ?? 0),
                                      intent,
                                      message: msg,
                                      roadReceiptJson: JSON.stringify(roadPayload),
                                    });
                                  }
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  </CollapsibleReceipt>
                </div>
              );
            })}

            {/* Hidden: sold rows */}
            <input
              type="hidden"
              name="roadReceiptsJson"
              value={JSON.stringify(
                receipts.map((rec) => {
                  const totals = computeReceiptTotals(rec);
                  return {
                    key: rec.key,
                    // CCS: clearance only used/processed when remaining > 0
                    needsClearance: !!rec.needsClearance,
                    clearanceReason: rec.clearanceReason ?? "",
                    clearanceIntent: (rec.clearanceIntent ??
                      (rec.customerId
                        ? "OPEN_BALANCE"
                        : "PRICE_BARGAIN")) as ClearanceIntentUI,
                    customerId: rec.customerId,
                    customerName: rec.customerName,
                    customerPhone: rec.customerPhone,
                    cashReceived: totals.cash,
                    lines: rec.lines
                      .filter(
                        (ln) =>
                          ln.qty > 0 &&
                          ln.productId != null &&
                          allowedPids.has(ln.productId),
                      )
                      .map((ln) => ({
                        productId: ln.productId,
                        name: ln.name,
                        qty: ln.qty,
                        // ✅ ROAD PACK-ONLY: never persist RETAIL for roadside
                        unitKind: PACK,
                        unitPrice: ln.unitPrice,
                      })),
                  };
                }),
              )}
            />
            {/* Hidden: parent clearance flags */}
            <input
              type="hidden"
              name="parentClearanceJson"
              value={JSON.stringify(
                parentReceiptsState.map((rec) => ({
                  orderId: rec.orderId,
                  needsClearance: !!rec.needsClearance,
                  clearanceReason: rec.clearanceReason ?? "",
                  clearanceIntent:
                    rec.clearanceIntent ??
                    (rec.customerId ? "OPEN_BALANCE" : "PRICE_BARGAIN"),
                })),
              )}
            />

            {/* Hidden: parent order cash collected (snapshot only) */}
            <input
              type="hidden"
              name="parentPaymentsJson"
              value={JSON.stringify(
                parentReceiptsState
                  .map((rec) => {
                    const total = Number(rec.orderTotal || 0);
                    const raw = rec.cashInput ?? rec.cashCollected ?? "";
                    const { clamped } = clampCashToTotal(total, raw);
                    return {
                      orderId: rec.orderId,
                      cashCollected: clamped,
                    };
                  })
                  .filter((x) => x.cashCollected > 0),
              )}
            />
          </div>

          {/* ACTION BUTTONS */}
          <div className="mt-6 grid gap-2">
            {/* Save Draft: persist data but DO NOT change status to CHECKED_IN */}
            <button
              type="submit"
              name="intent"
              value="save-draft"
              disabled={busy || locked}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save Draft"}
            </button>

            {/* Submit Check-in: FINAL for manager remit */}
            <button
              type="submit"
              name="intent"
              value="submit-checkin"
              disabled={busy || locked || hasSubmitBlock || hasUnsentClearance}
              aria-disabled={
                busy || locked || hasSubmitBlock || hasUnsentClearance
                  ? "true"
                  : "false"
              }
              title={submitDisabledReason ?? undefined}
              className={`inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-medium shadow-sm transition ${
                busy || locked || hasSubmitBlock || hasUnsentClearance
                  ? "bg-indigo-300 text-white cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {busy
                ? "Saving…"
                : hasSnapshot
                ? "Update & Submit Check-in"
                : "Submit Check-in"}
            </button>

            {/* ✅ More explicit “why disabled” helper */}
            {(hasSubmitBlock || hasUnsentClearance) && (
              <div className="text-center text-[11px] text-amber-700">
                {hasSubmitBlock
                  ? submitBlockedReason || "Clearance pending."
                  : "Send clearance for all receipts with remaining balance."}
              </div>
            )}
          </div>
        </Form>
      </div>
    </main>
  );
}
