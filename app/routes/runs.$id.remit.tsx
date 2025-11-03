/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { UnitKind } from "@prisma/client";
import { CustomerPicker } from "~/components/CustomerPicker";
import { CurrencyInput } from "~/components/ui/CurrencyInput";
import { computeUnitPriceForCustomer } from "~/services/pricing";
import { allocateReceiptNo } from "~/utils/receipt";

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: "PLANNED" | "DISPATCHED" | "CLOSED" | "CANCELLED";
    riderLabel: string | null;
    loadout: Array<{ productId: number; name: string; qty: number }>;
  };
  priceIndex: Record<number, number>; // pid -> default unit price (srp || price)
};

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      loadoutSnapshot: true,
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });
  if (run.status !== "DISPATCHED") {
    // Allow remit if already closed to show final summary UI
    if (run.status === "CLOSED") {
      // still show page but with empty loadout
    } else {
      throw new Response("Run is not dispatched yet.", { status: 400 });
    }
  }

  let riderLabel: string | null = null;
  if (run.riderId) {
    const r = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { firstName: true, lastName: true, alias: true },
    });
    riderLabel =
      (r?.alias?.trim() ||
        [r?.firstName, r?.lastName].filter(Boolean).join(" ") ||
        null) ??
      null;
  }

  const loadout: Array<{ productId: number; name: string; qty: number }> =
    Array.isArray(run.loadoutSnapshot)
      ? (run.loadoutSnapshot as any[])
          .map((l) => ({
            productId: Number(l?.productId),
            name: String(l?.name ?? ""),
            qty: Math.max(0, Math.floor(Number(l?.qty ?? 0))),
          }))
          .filter(
            (l) => Number.isFinite(l.productId) && l.productId > 0 && l.qty > 0
          )
      : [];

  const pids = Array.from(new Set(loadout.map((l) => l.productId)));
  const products = pids.length
    ? await db.product.findMany({
        where: { id: { in: pids } },
        select: { id: true, price: true, srp: true },
      })
    : [];
  const priceIndex = Object.fromEntries(
    products.map((p) => [p.id, Number(p.srp ?? p.price ?? 0)])
  ) as Record<number, number>;

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status as any,
      riderLabel,
      loadout,
    },
    priceIndex,
  });
}

type ActionData = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json<ActionData>(
      { ok: false, error: "Invalid ID" },
      { status: 400 }
    );
  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      runCode: true,
      riderId: true,
      loadoutSnapshot: true,
    },
  });
  if (!run)
    return json<ActionData>({ ok: false, error: "Not found" }, { status: 404 });
  if (run.status !== "DISPATCHED") {
    return json<ActionData>(
      { ok: false, error: "Run is not dispatched." },
      { status: 400 }
    );
  }

  const fd = await request.formData();
  const soldLoadJson = String(fd.get("soldLoadJson") || "[]");

  type SoldRow = {
    productId: number | null;
    name: string;
    qty: number;
    unitPrice: number;
    customerId?: number | null;
    onCredit?: boolean;
  };
  let soldRows: SoldRow[] = [];
  try {
    const parsed = JSON.parse(soldLoadJson);
    if (Array.isArray(parsed)) {
      soldRows = parsed
        .map((r) => ({
          productId:
            r?.productId == null || isNaN(Number(r.productId))
              ? null
              : Number(r.productId),
          name: typeof r?.name === "string" ? r.name : "",
          qty: Math.max(0, Math.floor(Number(r?.qty ?? 0))),
          unitPrice: Math.max(0, Number(r?.unitPrice ?? 0)),
          customerId:
            r?.customerId == null || isNaN(Number(r.customerId))
              ? null
              : Number(r.customerId),
          onCredit: Boolean(r?.onCredit),
        }))
        .filter((r) => r.qty > 0 && r.productId != null);
    }
  } catch {}

  // derive loaded qty per product from snapshot
  const loadout: Array<{ productId: number; name: string; qty: number }> =
    Array.isArray(run.loadoutSnapshot)
      ? (run.loadoutSnapshot as any[])
          .map((l) => ({
            productId: Number(l?.productId),
            name: String(l?.name ?? ""),
            qty: Math.max(0, Math.floor(Number(l?.qty ?? 0))),
          }))
          .filter(
            (l) => Number.isFinite(l.productId) && l.productId > 0 && l.qty > 0
          )
      : [];

  const loadedByPid = new Map<number, number>();
  for (const l of loadout)
    loadedByPid.set(l.productId, (loadedByPid.get(l.productId) || 0) + l.qty);

  // sum sold per pid
  const soldByPid = new Map<number, number>();
  for (const r of soldRows)
    soldByPid.set(r.productId!, (soldByPid.get(r.productId!) || 0) + r.qty);

  // Guard: sold ≤ loaded
  const over: string[] = [];
  for (const [pid, soldQ] of soldByPid.entries()) {
    const loadedQ = loadedByPid.get(pid) || 0;
    if (soldQ > loadedQ)
      over.push(`• #${pid}: sold ${soldQ} > loaded ${loadedQ}`);
  }
  if (over.length) {
    return json<ActionData>(
      { ok: false, error: "Sold quantity exceeds loaded:\n" + over.join("\n") },
      { status: 400 }
    );
  }

  // price guard (PACK): below-allowed ok only if onCredit && has customer
  const pids = Array.from(new Set(soldRows.map((r) => r.productId!)));
  const products = pids.length
    ? await db.product.findMany({
        where: { id: { in: pids } },
        select: { id: true, price: true, srp: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  for (const r of soldRows) {
    const p = byId.get(r.productId!);
    if (!p) continue;
    const basePack = Number(p.srp ?? p.price ?? 0);
    const allowed = await computeUnitPriceForCustomer(db as any, {
      customerId: r.customerId ?? null,
      productId: r.productId!,
      unitKind: UnitKind.PACK,
      baseUnitPrice: basePack,
    });
    const creditRow = !!r.onCredit && !!r.customerId;
    if (r.unitPrice + 1e-6 < allowed && !creditRow) {
      return json<ActionData>(
        {
          ok: false,
          error: `Below allowed price for #${r.productId}. Link customer & mark On credit to allow.`,
        },
        { status: 400 }
      );
    }
    if (r.onCredit && !r.customerId) {
      return json<ActionData>(
        { ok: false, error: "On-credit sale requires a customer." },
        { status: 400 }
      );
    }
  }

  await db.$transaction(async (tx) => {
    // For each sold row → create Order (+Payment if cash), link to run
    for (const r of soldRows) {
      const p = byId.get(r.productId!)!;
      const basePack = Number(p.srp ?? p.price ?? 0);
      const allowed = await computeUnitPriceForCustomer(tx as any, {
        customerId: r.customerId ?? null,
        productId: r.productId!,
        unitKind: UnitKind.PACK,
        baseUnitPrice: basePack,
      });
      // auto-apply allowed when price ~ base and we have customer
      const approx = (a: number, b: number, eps = 0.009) =>
        Math.abs(a - b) <= eps;
      const autoUseAllowed =
        !!r.customerId && (r.unitPrice <= 0 || approx(r.unitPrice, basePack));
      const unitPrice = autoUseAllowed ? allowed : r.unitPrice;
      const lineTotal = Number((unitPrice * r.qty).toFixed(2));

      const code =
        `RS-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-` +
        crypto.randomUUID().slice(0, 6).toUpperCase();
      const isCredit = !!r.onCredit;

      const order = await tx.order.create({
        data: {
          channel: "DELIVERY",
          status: isCredit ? "PARTIALLY_PAID" : "PAID",
          paidAt: isCredit ? null : new Date(),
          orderCode: code,
          printedAt: new Date(),
          expiryAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
          // snapshot riderLabel into riderName for ticket (optional)
          riderName: run.riderId
            ? (
                await tx.employee.findUnique({
                  where: { id: run.riderId },
                  select: { alias: true, firstName: true, lastName: true },
                })
              )?.alias ??
              ((await tx.employee.findUnique({
                where: { id: run.riderId },
                select: { firstName: true, lastName: true },
              })) &&
                (
                  await tx.employee.findUnique({
                    where: { id: run.riderId },
                    select: { firstName: true, lastName: true },
                  })
                )?.firstName +
                  " " +
                  (
                    await tx.employee.findUnique({
                      where: { id: run.riderId },
                      select: { firstName: true, lastName: true },
                    })
                  )?.lastName)
            : null,
          ...(r.customerId ? { customerId: r.customerId } : {}),
          isOnCredit: isCredit,
          subtotal: lineTotal,
          totalBeforeDiscount: lineTotal,
          dispatchedAt: new Date(),
          deliveredAt: new Date(),
          items: {
            create: [
              {
                productId: r.productId!,
                name: r.name,
                qty: r.qty,
                unitPrice,
                lineTotal,
                unitKind: UnitKind.PACK,
                allowedUnitPrice: allowed,
                pricePolicy:
                  Math.abs(allowed - basePack) <= 0.009 ? "BASE" : "PER_ITEM",
              },
            ],
          },
        },
        select: { id: true },
      });
      const receiptNo = await allocateReceiptNo(tx);
      await tx.order.update({ where: { id: order.id }, data: { receiptNo } });
      // payment for cash rows
      if (!isCredit) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            method: "CASH",
            amount: lineTotal,
            refNo: "RUN-LOAD-SALE",
          },
        });
      }
      // link order to run
      await tx.deliveryRunOrder.create({
        data: { runId: id, orderId: order.id },
      });
    }

    // compute leftovers = loaded - sold → return to stock + create RETURN_IN
    const soldMap = new Map<number, number>();
    for (const r of soldRows)
      soldMap.set(r.productId!, (soldMap.get(r.productId!) || 0) + r.qty);
    for (const l of loadout) {
      const sold = soldMap.get(l.productId) || 0;
      const leftover = Math.max(0, l.qty - sold);
      if (leftover > 0) {
        await tx.product.update({
          where: { id: l.productId },
          data: { stock: { increment: leftover } },
        });
        await tx.stockMovement.create({
          data: {
            type: "RETURN_IN",
            productId: l.productId,
            qty: leftover,
            refKind: "RUN",
            refId: id,
            notes: "Run remit return",
          },
        });
      }
    }
  });

  // After posting, go to the Run Summary page (plan spec)
  return redirect(`/runs/${id}/summary?posted=1`);
}

export default function RunRemitPage() {
  const { run, priceIndex } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const posted =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("posted") === "1"
      : false;

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  type SoldRowUI = {
    key: string;
    productId: number | null;
    name: string;
    qty: number;
    unitPrice: number;
    customerId?: number | null;
    onCredit?: boolean;
    customerObj?: {
      id: number;
      firstName: string;
      lastName: string;
      alias?: string | null;
      phone?: string | null;
    } | null;
    allowedUnitPrice?: number | null;
    touched?: boolean;
  };

  const [soldRows, setSoldRows] = React.useState<SoldRowUI[]>([]);

  const defaultPriceFor = React.useCallback(
    (pid: number | null) => {
      return pid != null && priceIndex[pid] != null
        ? Number(priceIndex[pid])
        : 0;
    },
    [priceIndex]
  );

  const fetchAllowed = React.useCallback(
    async (
      customerId: number | null | undefined,
      productId: number | null | undefined
    ) => {
      if (!productId) return null;
      try {
        const u = new URL("/resources/pricing/allowed", window.location.origin);
        if (customerId) u.searchParams.set("cid", String(customerId));
        u.searchParams.set("pid", String(productId));
        u.searchParams.set("unit", "PACK");
        const res = await fetch(u.toString());
        if (!res.ok) return null;
        const j = await res.json();
        if (j?.ok && Number.isFinite(j.allowed)) return Number(j.allowed);
      } catch {}
      return null;
    },
    []
  );

  const refreshRowAllowed = React.useCallback(
    async (rowKey: string, cid: number | null, pid: number | null) => {
      const allowed = await fetchAllowed(cid, pid);
      setSoldRows((prev) =>
        prev.map((r) => {
          if (r.key !== rowKey) return r;
          const base = defaultPriceFor(pid);
          const shouldPrefill =
            !r.touched ||
            !Number.isFinite(r.unitPrice) ||
            Math.abs((r.unitPrice || 0) - base) <= 0.0001;
          const hasAllowed =
            typeof allowed === "number" && Number.isFinite(allowed);
          return {
            ...r,
            allowedUnitPrice: allowed,
            unitPrice:
              shouldPrefill && hasAllowed ? (allowed as number) : r.unitPrice,
          };
        })
      );
    },
    [fetchAllowed, defaultPriceFor]
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Run Remit
            </h1>
            <div className="mt-1 text-sm text-slate-500">
              Run{" "}
              <span className="font-mono font-medium text-indigo-700">
                {run.runCode}
              </span>
              {run.riderLabel ? (
                <span className="ml-2">• Rider: {run.riderLabel}</span>
              ) : null}
            </div>
          </div>
          {(() => {
            const badgeText =
              run.status === "CLOSED" ? "Closed" : posted ? "Posted" : null;
            return badgeText ? (
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                {badgeText}
              </div>
            ) : null;
          })()}
        </div>

        <Form method="post" className="grid gap-4">
          {actionData && !actionData.ok ? (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 whitespace-pre-line"
              aria-live="polite"
            >
              {actionData.error}
            </div>
          ) : null}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  Sold from Load
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  One receipt per row. PACK pricing applies.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSoldRows((prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      productId: null,
                      name: "",
                      qty: 1,
                      unitPrice: 0,
                      customerId: null,
                      onCredit: false,
                    },
                  ])
                }
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                + Add sold row
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              {soldRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-sm text-slate-500">
                  No sold rows yet.
                </div>
              ) : null}

              {soldRows.map((r, idx) => (
                <div
                  key={r.key}
                  className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-700">
                      Item #{idx + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSoldRows((prev) =>
                          prev.filter((x) => x.key !== r.key)
                        )
                      }
                      className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                      aria-label="Remove row"
                      title="Remove row"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-12 lg:col-span-7">
                      {/* Custom component: use plain text instead of <label> to satisfy jsx-a11y */}
                      <div className="mb-1 block text-xs font-medium text-slate-600">
                        Customer (optional; required if On credit)
                      </div>
                      <CustomerPicker
                        key={`sold-cust-${r.key}`}
                        value={r.customerObj ?? null}
                        onChange={(val) => {
                          const norm = val
                            ? {
                                id: val.id,
                                firstName: val.firstName ?? "",
                                lastName: val.lastName ?? "",
                                alias: val.alias ?? null,
                                phone: val.phone ?? null,
                              }
                            : null;
                          setSoldRows((prev) =>
                            prev.map((x) =>
                              x.key === r.key
                                ? {
                                    ...x,
                                    customerObj: norm,
                                    customerId: norm?.id ?? null,
                                  }
                                : x
                            )
                          );
                          const cid = norm?.id ?? null;
                          const pid = r.productId ?? null;
                          if (pid) void refreshRowAllowed(r.key, cid, pid);
                        }}
                      />
                    </div>
                    <div className="col-span-12 lg:col-span-5 flex items-end">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!r.onCredit}
                          onChange={(e) => {
                            const onCredit = e.target.checked;
                            setSoldRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key ? { ...x, onCredit } : x
                              )
                            );
                          }}
                          className="h-4 w-4 accent-indigo-600"
                        />
                        <span>Mark as credit (A/R)</span>
                      </label>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-12 gap-3">
                    <div className="col-span-12 md:col-span-7">
                      {(() => {
                        const inputId = `sold-${r.key}-product`;
                        return (
                          <>
                            <label
                              htmlFor={inputId}
                              className="mb-1 block text-xs font-medium text-slate-600"
                            >
                              Product
                            </label>
                            <input
                              id={inputId}
                              list="runLoadList"
                              value={
                                r.productId != null
                                  ? `${r.productId} | ${r.name}`
                                  : r.name
                              }
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                let pid: number | null = null;
                                let name = raw;
                                const m = raw.match(/^(\d+)\s*\|\s*(.+)$/);
                                if (m) {
                                  pid = Number(m[1]);
                                  name = m[2];
                                } else if (/^\d+$/.test(raw)) {
                                  const found = run.loadout.find(
                                    (x) => x.productId === Number(raw)
                                  );
                                  if (found) {
                                    pid = found.productId;
                                    name = found.name;
                                  }
                                } else {
                                  const found = run.loadout.find(
                                    (x) => x.name === raw
                                  );
                                  if (found) {
                                    pid = found.productId;
                                    name = found.name;
                                  }
                                }
                                setSoldRows((prev) =>
                                  prev.map((x) =>
                                    x.key === r.key
                                      ? {
                                          ...x,
                                          productId: pid,
                                          name,
                                          unitPrice:
                                            pid != null && !x.touched
                                              ? defaultPriceFor(pid)
                                              : x.unitPrice,
                                          allowedUnitPrice: undefined,
                                        }
                                      : x
                                  )
                                );
                                const cid = r.customerId ?? null;
                                if (pid)
                                  void refreshRowAllowed(r.key, cid, pid);
                              }}
                              placeholder="Search load: 123 | Product name"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                            />
                          </>
                        );
                      })()}
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      {(() => {
                        const qtyId = `sold-${r.key}-qty`;
                        return (
                          <>
                            <label
                              htmlFor={qtyId}
                              className="mb-1 block text-xs font-medium text-slate-600"
                            >
                              Qty
                            </label>
                            <input
                              id={qtyId}
                              type="number"
                              min={0}
                              step="1"
                              value={r.qty}
                              onChange={(e) => {
                                const v = Math.max(
                                  0,
                                  Math.floor(Number(e.target.value))
                                );
                                setSoldRows((prev) =>
                                  prev.map((x) =>
                                    x.key === r.key ? { ...x, qty: v } : x
                                  )
                                );
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-right outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                            />
                          </>
                        );
                      })()}
                    </div>
                    <div className="col-span-6 md:col-span-3">
                      {(() => {
                        const base = defaultPriceFor(r.productId);
                        const unit = Number(r.unitPrice || 0);
                        const line = Number(r.qty || 0) * unit || 0;
                        const allowed = Number.isFinite(
                          r.allowedUnitPrice as number
                        )
                          ? (r.allowedUnitPrice as number)
                          : null;
                        const disc = Math.max(0, base - unit);
                        const custDisc =
                          allowed != null ? Math.max(0, base - allowed) : null;
                        const belowAllowed =
                          allowed != null && unit + 1e-6 < allowed;
                        return (
                          <div className="mb-1 text-[11px] text-slate-500 grid gap-0.5">
                            <div className="flex justify-between">
                              <span>Original</span>
                              <span className="tabular-nums">{peso(base)}</span>
                            </div>
                            {allowed != null && (
                              <div className="flex justify-between">
                                <span>Customer price (PACK)</span>
                                <span className="tabular-nums">
                                  {peso(allowed)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Discount</span>
                              <span className="tabular-nums text-rose-600">
                                −{peso(disc)}
                              </span>
                            </div>
                            {custDisc != null && (
                              <div className="flex justify-between text-slate-400">
                                <span>of which rule-based</span>
                                <span className="tabular-nums">
                                  −{peso(custDisc)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Final (per unit)</span>
                              <span className="tabular-nums">{peso(unit)}</span>
                            </div>
                            {belowAllowed && (
                              <div className="flex justify-between text-rose-600">
                                <span>Below allowed</span>
                                <span className="tabular-nums">
                                  min {peso(allowed!)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Line total</span>
                              <span className="tabular-nums">{peso(line)}</span>
                            </div>
                          </div>
                        );
                      })()}
                      <CurrencyInput
                        name={`unitPrice-${r.key}`}
                        label="Unit price"
                        value={String(r.unitPrice ?? "")}
                        onChange={(e) => {
                          const v = Math.max(
                            0,
                            Number(
                              String(e.target.value).replace(/[^0-9.]/g, "")
                            ) || 0
                          );
                          setSoldRows((prev) =>
                            prev.map((x) =>
                              x.key === r.key
                                ? { ...x, unitPrice: v, touched: true }
                                : x
                            )
                          );
                        }}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {/* datalist for product search from loadout */}
              <datalist id="runLoadList">
                {run.loadout.map((l, i) => (
                  <option
                    key={`${l.productId}-${i}`}
                    value={`${l.productId} | ${l.name}`}
                  />
                ))}
              </datalist>
            </div>
          </div>

          {/* Hidden payload */}
          <input
            type="hidden"
            name="soldLoadJson"
            value={JSON.stringify(
              soldRows
                .filter((r) => r.qty > 0 && r.productId != null)
                .map((r) => ({
                  productId: r.productId,
                  name: r.name,
                  qty: r.qty,
                  unitPrice: Number(Number(r.unitPrice).toFixed(2)),
                  customerId: r.customerId ?? null,
                  onCredit: !!r.onCredit,
                }))
            )}
          />

          <div className="sticky bottom-4">
            <button
              className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              disabled={nav.state !== "idle"}
            >
              {nav.state !== "idle" ? "Posting…" : "Post Remit & Close Run"}
            </button>
          </div>
        </Form>
      </div>
    </main>
  );
}
