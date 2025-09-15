// app/routes/orders.$id.dispatch.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { FulfillmentStatus } from "@prisma/client";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

// Temporary: built-in vehicle catalog for M1 (no schema yet)
const VEHICLE_CAPACITY: Record<string, number> = {
  Tricycle: 12, // Max LPG cylinders (hint)
  Motorcycle: 4,
  Sidecar: 8,
  Multicab: 25,
};

type LoaderData = {
  riderName: string | null;
  vehicleName: string | null;
  loadoutSnapshot: Array<{
    productId: number | null;
    name: string;
    qty: number;
    allowDecimal?: boolean;
  }> | null;
  riderOptions: string[]; // suggestions (distinct recent riders)
  productOptions: Array<{
    id: number;
    name: string;
    allowDecimal: boolean; // based on product.unit (retail supports decimal in your system)
  }>;
  order: {
    id: number;
    orderCode: string;
    fulfillmentStatus: string | null;
    dispatchedAt?: string | null;
    deliveredAt?: string | null;
    stagedAt?: string | null;
    customer?: {
      id: number;
      name: string | null;
      phone: string | null;
    } | null;
    items: Array<{
      id: number;
      name: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }>;
    totals: {
      subtotal: number;
      totalBeforeDiscount: number;
    };
  };
  readOnly: boolean;
};

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderCode: true,
      fulfillmentStatus: true,
      dispatchedAt: true,
      deliveredAt: true,
      stagedAt: true,
      riderName: true,
      vehicleName: true,
      loadoutSnapshot: true,
      totalBeforeDiscount: true,
      subtotal: true,
      customer: {
        select: {
          id: true,
          alias: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
      items: {
        select: {
          id: true,
          name: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });

  // Lightweight product catalog for loadout picker — LPG ONLY
  // Filter by category name = "LPG" so cashier can only add LPG items to loadout.
  const lpgProducts = await db.product.findMany({
    where: { isActive: true, category: { name: "LPG" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  // LPG loadout is per tank; disallow decimals for safety
  const productOptions = lpgProducts.map((p) => ({
    id: p.id,
    name: p.name,
    allowDecimal: false,
  }));

  // Build rider suggestions:
  // - include active Employees with role=RIDER
  // - plus distinct rider names from recent orders
  const [employees, recentRiders] = await Promise.all([
    db.employee.findMany({
      where: { role: "RIDER", active: true },
      select: { alias: true, firstName: true, lastName: true },
      orderBy: [{ alias: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
      take: 100,
    }),
    db.order.findMany({
      where: { riderName: { not: null } },
      select: { riderName: true },
      take: 30,
      orderBy: { dispatchedAt: "desc" },
    }),
  ]);
  const employeeNames = employees
    .map((e) =>
      (
        e.alias?.trim() || [e.firstName, e.lastName].filter(Boolean).join(" ")
      ).trim()
    )
    .filter(Boolean);
  const recentNames = recentRiders
    .map((r) => (r.riderName ?? "").trim())
    .filter(Boolean);
  const riderOptions = Array.from(
    new Set([...employeeNames, ...recentNames])
  ).slice(0, 50);

  if (!order) throw new Response("Not found", { status: 404 });

  const customerName = order.customer
    ? order.customer.alias ??
      [order.customer.firstName, order.customer.lastName]
        .filter(Boolean)
        .join(" ")
    : null;

  const data: LoaderData = {
    riderName: order.riderName ?? null,
    vehicleName: order.vehicleName ?? null,
    loadoutSnapshot: Array.isArray(order.loadoutSnapshot)
      ? (order.loadoutSnapshot as any)
      : null,
    riderOptions,
    productOptions,
    order: {
      id: order.id,
      orderCode: order.orderCode,
      fulfillmentStatus: order.fulfillmentStatus,
      dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      stagedAt: order.stagedAt?.toISOString() ?? null,
      customer: order.customer
        ? {
            id: order.customer.id,
            name: customerName,
            phone: order.customer.phone ?? null,
          }
        : null,
      items: order.items.map((it) => ({
        id: it.id,
        name: it.name,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
      })),
      totals: {
        subtotal: Number(order.subtotal),
        totalBeforeDiscount: Number(order.totalBeforeDiscount),
      },
    },
    readOnly: order.fulfillmentStatus === "DISPATCHED",
  };

  return json(data);
}

type ActionData = { ok: true; message?: string } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json<ActionData>(
      { ok: false, error: "Invalid ID" },
      { status: 400 }
    );

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  // form fields
  const riderName = String(form.get("riderName") ?? "").trim() || null;

  // vehicle snapshot (stored on Order for ticketing/reprint)
  const vehicleName =
    (typeof form.get("vehicleName") === "string"
      ? String(form.get("vehicleName")).trim()
      : "") || null;

  // capacity (optional hint from dropdown; treat as guard if present)
  const vehicleCapacityRaw = form.get("vehicleCapacity");
  const vehicleCapacity = vehicleCapacityRaw
    ? Number(vehicleCapacityRaw)
    : null;

  // loadout snapshot (UI only for now)
  const loadoutJson = String(form.get("loadoutJson") ?? "") || "[]";
  let loadoutSnapshot: Array<{
    productId: number | null;
    name: string;
    qty: number;
    allowDecimal?: boolean;
  }> = [];
  try {
    loadoutSnapshot = JSON.parse(loadoutJson);
    if (!Array.isArray(loadoutSnapshot)) loadoutSnapshot = [];
    // normalize qty (defensive: non-negative numbers only)
    loadoutSnapshot = loadoutSnapshot.map((l) => ({
      productId: l?.productId == null ? null : Number(l.productId),
      name: typeof l?.name === "string" ? l.name : "",
      qty: Math.max(0, Number(l?.qty ?? 0)),
      allowDecimal: Boolean(l?.allowDecimal),
    }));
  } catch {
    // tolerate bad JSON but don’t persist it
    loadoutSnapshot = [];
  }
  // Load current status to enforce read-only behavior after dispatch
  const order = await db.order.findUnique({
    where: { id },
    select: { fulfillmentStatus: true, riderName: true },
  });
  if (!order)
    return json<ActionData>(
      { ok: false, error: "Order not found" },
      { status: 404 }
    );

  const isReadOnly = order.fulfillmentStatus === "DISPATCHED";

  // compute used capacity for server-side validation
  const usedCapacity = loadoutSnapshot.reduce(
    (s, l) => s + (Number.isFinite(l.qty) ? Number(l.qty) : 0),
    0
  );
  if (vehicleCapacity != null && usedCapacity > vehicleCapacity) {
    return json<ActionData>(
      {
        ok: false,
        error: "Capacity exceeded — adjust loadout or change vehicle.",
      },
      { status: 400 }
    );
  }

  // 🔒 Server-side guard: loadout must reference LPG products only
  // Find non-null productIds in the snapshot
  const postedIds = Array.from(
    new Set(
      loadoutSnapshot
        .map((l) => (l.productId == null ? null : Number(l.productId)))
        .filter((v): v is number => Number.isFinite(v))
    )
  );
  if (postedIds.length > 0) {
    const rows = await db.product.findMany({
      where: { id: { in: postedIds } },
      select: { id: true, category: { select: { name: true } } },
    });
    const invalid = rows
      .filter((r) => r.category?.name !== "LPG")
      .map((r) => r.id);
    if (invalid.length > 0) {
      return json<ActionData>(
        {
          ok: false,
          error: "Loadout can only include LPG items.",
        },
        { status: 400 }
      );
    }
  }

  switch (intent) {
    case "cancel":
      return redirect(`/cashier/${id}`);

    case "save-exit":
      if (isReadOnly) {
        return json<ActionData>(
          { ok: false, error: "Already dispatched." },
          { status: 400 }
        );
      }
      await db.order.update({
        where: { id },
        data: {
          riderName,
          vehicleName,
          loadoutSnapshot: loadoutSnapshot as any,
          fulfillmentStatus: FulfillmentStatus.STAGED,
          stagedAt: new Date(),
        },
      });
      return redirect(`/cashier/${id}`);

    case "save":
      if (isReadOnly) {
        return json<ActionData>(
          { ok: false, error: "Already dispatched." },
          { status: 400 }
        );
      }
      // Persist STAGED snapshot (rider, vehicle, loadout) and timestamp
      await db.order.update({
        where: { id },
        data: {
          riderName,
          vehicleName,
          loadoutSnapshot: loadoutSnapshot as any,
          fulfillmentStatus: FulfillmentStatus.STAGED,
          stagedAt: new Date(),
        },
      });
      return redirect(`/orders/${id}/dispatch?saved=1`);
    case "dispatch":
      // Guard: rider is required
      if (!riderName && !order.riderName) {
        return json<ActionData>(
          { ok: false, error: "Rider is required before dispatch." },
          { status: 400 }
        );
      }
      if (isReadOnly) {
        return json<ActionData>({ ok: true });
      }

      // Inventory side-effects for LPG loadout:
      // Decrement PACK stock (`stock`) by the qty of each load line with productId.
      await db.$transaction(async (tx) => {
        // 1) Deduct loadout items (pack units)
        for (const line of loadoutSnapshot) {
          if (!line?.productId || !Number.isFinite(line.qty) || line.qty <= 0)
            continue;
          await tx.product.update({
            where: { id: Number(line.productId) },
            data: { stock: { decrement: Number(line.qty) } },
          });
        }

        // 2) Mark order as dispatched and persist snapshots
        await tx.order.update({
          where: { id },
          data: {
            riderName,
            vehicleName,
            loadoutSnapshot: loadoutSnapshot as any,
            fulfillmentStatus: FulfillmentStatus.DISPATCHED,
            dispatchedAt: new Date(),
          },
        });
      });

      // 3) Go to ticket (auto-print + back)
      return redirect(`/orders/${id}/ticket?autoprint=1&autoback=1`);

    case "reprint":
      if (!isReadOnly) {
        return json<ActionData>(
          { ok: false, error: "Not dispatched yet." },
          { status: 400 }
        );
      }
      // No side effects here; printing is handled by /orders/:id/ticket
      return json<ActionData>({ ok: true });

    default:
      return json<ActionData>(
        { ok: false, error: "Unknown intent" },
        { status: 400 }
      );
  }
}

function peso(n: number) {
  return n.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
}

export default function DispatchStagingPage() {
  const {
    order,
    readOnly,
    riderName: riderFromServer,
    vehicleName: vehicleFromServer,
    loadoutSnapshot,
    riderOptions,
    productOptions,
  } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const [searchParams] = useSearchParams();
  const savedFlag = searchParams.get("saved") === "1";
  const busy = nav.state !== "idle";
  const [riderName, setRiderName] = React.useState<string>(
    riderFromServer ?? ""
  );
  const hasRider = riderName.trim().length > 0;
  const disableAll = busy;
  // Vehicle UI state
  const [vehicleName, setVehicleName] = React.useState<string>(
    vehicleFromServer ?? ""
  );
  const capacity = React.useMemo(() => {
    const cap = VEHICLE_CAPACITY[vehicleName as keyof typeof VEHICLE_CAPACITY];
    return Number.isFinite(cap) ? cap : null;
  }, [vehicleName]);
  // expose capacity to form posts
  const capacityAttr = capacity == null ? "" : String(capacity);
  // Loadout UI state
  type LoadLine = {
    key: string;
    productId: number | null;
    name: string;
    qty: number;
    allowDecimal: boolean;
  };
  const [loadout, setLoadout] = React.useState<LoadLine[]>(
    Array.isArray(loadoutSnapshot)
      ? loadoutSnapshot.map((x) => ({
          key: crypto.randomUUID(),
          productId: x.productId ?? null,
          name: x.name ?? "",
          qty: Number(x.qty ?? 0),
          allowDecimal: Boolean(x.allowDecimal),
        }))
      : []
  );
  const usedCapacity = React.useMemo(
    () =>
      loadout.reduce(
        (s, L) => s + (Number.isFinite(L.qty) ? Number(L.qty) : 0),
        0
      ),
    [loadout]
  );
  const overCapacity = capacity != null && usedCapacity > capacity;

  return (
    <div className="mx-auto max-w-3xl p-3 md:p-6">
      <div className="mb-3">
        <Link
          to={`/cashier/${order.id}`}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Back to Cashier
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4 md:p-5">
          <h1 className="text-lg md:text-xl font-semibold text-slate-900">
            Dispatch Staging — Order{" "}
            <span className="font-mono text-indigo-700">{order.orderCode}</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {readOnly
              ? "Already dispatched (read-only). You can reprint the ticket."
              : "Review order, then assign rider and dispatch."}
          </p>
        </div>
        {/* success inline banner after Save & Stay */}
        {savedFlag && (
          <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Staging saved.
          </div>
        )}
        {actionData && !actionData.ok && (
          <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionData.error}
          </div>
        )}

        <div className="p-4 md:p-5 grid gap-4">
          {/* Customer */}
          <div className="grid gap-1">
            <div className="text-xs text-slate-500">Customer</div>
            <div className="text-sm font-medium text-slate-800">
              {order.customer?.name ?? "—"}
              {order.customer?.phone ? (
                <span className="text-slate-500">
                  {" "}
                  • {order.customer.phone}
                </span>
              ) : null}
            </div>
          </div>

          {/* Items */}
          <div className="rounded-xl border border-slate-200">
            <div className="px-3 py-2 text-xs font-medium text-slate-600 border-b border-slate-200">
              Items
            </div>
            <div className="divide-y">
              {order.items.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">
                      {it.name}
                    </div>
                    <div className="text-xs text-slate-500">{it.qty}</div>
                  </div>
                  <div className="shrink-0 font-medium">
                    {peso(it.lineTotal)}
                  </div>
                </div>
              ))}
              <div className="px-3 py-2 text-sm flex justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span>{peso(order.totals.subtotal)}</span>
              </div>
              <div className="px-3 py-2 text-sm flex justify-between">
                <span className="text-slate-600">Total (snapshot)</span>
                <span>{peso(order.totals.totalBeforeDiscount)}</span>
              </div>
            </div>
          </div>

          {/* Rider selector (Issue 2) */}
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-slate-800">
                Rider <span className="text-rose-600">*</span>
              </div>
              {!readOnly && (
                <span
                  className={`text-xs ${
                    hasRider ? "text-emerald-700" : "text-slate-500"
                  }`}
                >
                  {hasRider ? "Ready" : "Required to dispatch"}
                </span>
              )}
            </div>
            {readOnly ? (
              <div className="text-sm text-slate-700">
                {riderFromServer ?? "—"}
              </div>
            ) : (
              <div className="grid gap-1">
                <select
                  name="riderName"
                  form="dispatch-form"
                  value={riderName}
                  onChange={(e) => setRiderName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  disabled={disableAll}
                  required
                >
                  <option value="">— Select rider —</option>
                  {riderOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Choose from active riders (seeded Employees with role=RIDER).
                </p>
              </div>
            )}
          </div>

          {/* Vehicle selector (Issue 3 — optional, with capacity hint) */}
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-slate-800">
                Vehicle <span className="text-slate-400">(optional)</span>
              </div>
              {vehicleName ? (
                <span className="text-xs text-slate-600">
                  {capacity != null
                    ? `Capacity: Max LPG ${capacity}`
                    : "No capacity profile"}
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  If empty, rider default applies (when configured)
                </span>
              )}
            </div>
            {readOnly ? (
              <div className="text-sm text-slate-700">
                {/* future: show persisted vehicle snapshot */}—
              </div>
            ) : (
              <div className="grid gap-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={vehicleName}
                    onChange={(e) => setVehicleName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                    disabled={disableAll}
                    aria-label="Vehicle"
                  >
                    <option value="">— Select vehicle —</option>
                    {Object.keys(VEHICLE_CAPACITY).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="hidden"
                  name="vehicleName"
                  value={vehicleName}
                  form="dispatch-form"
                />
                <input
                  type="hidden"
                  name="vehicleCapacity"
                  value={capacityAttr}
                  form="dispatch-form"
                />
              </div>
            )}
          </div>

          {/* Loadout (Issue 4 — UI only) */}
          <div className="rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <div className="text-sm font-medium text-slate-800">Loadout</div>
              <div
                className={`text-xs font-medium ${
                  overCapacity ? "text-rose-700" : "text-slate-600"
                }`}
              >
                Used / Max:{" "}
                <span
                  className={`${
                    overCapacity ? "text-rose-700" : "text-slate-900"
                  }`}
                >
                  {usedCapacity}
                  {capacity != null ? ` / ${capacity}` : " / —"}
                </span>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {/* Quick-add shortcuts (best effort — looks for LPG SKUs) */}
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  {["11", "22"].map((kg) => {
                    const match = productOptions.find(
                      (p) =>
                        /lpg/i.test(p.name) &&
                        new RegExp(`\\b${kg}\\s?kg\\b`, "i").test(p.name)
                    );
                    if (!match) return null;
                    return (
                      <button
                        key={kg}
                        type="button"
                        onClick={() => {
                          setLoadout((prev) => {
                            const existing = prev.find(
                              (l) => l.productId === match.id
                            );
                            if (existing) {
                              return prev.map((l) =>
                                l.productId === match.id
                                  ? { ...l, qty: Number(l.qty) + 1 }
                                  : l
                              );
                            }
                            return [
                              ...prev,
                              {
                                key: crypto.randomUUID(),
                                productId: match.id,
                                name: match.name,
                                qty: 1,
                                allowDecimal: match.allowDecimal,
                              },
                            ];
                          });
                        }}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        + LPG {kg}kg
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setLoadout((prev) => [
                        ...prev,
                        {
                          key: crypto.randomUUID(),
                          productId: null,
                          name: "",
                          qty: 1,
                          allowDecimal: false,
                        },
                      ])
                    }
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    + Add row
                  </button>
                </div>
              )}

              {/* Loadout rows */}
              <div className="grid gap-2">
                {loadout.length === 0 ? (
                  <div className="text-sm text-slate-500">No loadout yet.</div>
                ) : (
                  loadout.map((L) => (
                    <div
                      key={L.key}
                      className={`grid grid-cols-12 items-center gap-2 rounded-xl border px-2 py-2 ${
                        overCapacity
                          ? "border-rose-300 bg-rose-50/40"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      {/* Product selector (simple filterable select) */}
                      <div className="col-span-7 sm:col-span-8">
                        {readOnly ? (
                          <div className="text-sm text-slate-800 truncate">
                            {L.name || "—"}
                          </div>
                        ) : (
                          <div className="grid gap-1">
                            <input
                              list="loadoutProducts"
                              value={L.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                const found = productOptions.find(
                                  (p) => p.name === val
                                );
                                setLoadout((prev) =>
                                  prev.map((x) =>
                                    x.key === L.key
                                      ? {
                                          ...x,
                                          name: val,
                                          productId: found?.id ?? null,
                                          allowDecimal:
                                            found?.allowDecimal ?? false,
                                        }
                                      : x
                                  )
                                );
                              }}
                              placeholder="Search product…"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                              autoComplete="off"
                            />
                          </div>
                        )}
                      </div>
                      {/* Qty */}
                      <div className="col-span-4 sm:col-span-3">
                        {readOnly ? (
                          <div className="text-sm text-right tabular-nums">
                            {L.qty}
                          </div>
                        ) : (
                          <input
                            type="number"
                            step={L.allowDecimal ? "0.01" : "1"} // stays false for LPG
                            min="0"
                            value={L.qty}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setLoadout((prev) =>
                                prev.map((x) =>
                                  x.key === L.key
                                    ? { ...x, qty: isNaN(val) ? 0 : val }
                                    : x
                                )
                              );
                            }}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-right outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                          />
                        )}
                      </div>
                      {/* Remove */}
                      <div className="col-span-1 text-right">
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label="Remove row"
                            onClick={() =>
                              setLoadout((prev) =>
                                prev.filter((x) => x.key !== L.key)
                              )
                            }
                            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {/* datalist for product search */}
              <datalist id="loadoutProducts">
                {productOptions.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Actions */}
          <Form
            id="dispatch-form"
            method="post"
            replace
            className={`flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end ${
              busy ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            {/* Hidden fields inside the form so they POST correctly */}
            <input type="hidden" name="vehicleName" value={vehicleName} />
            <input type="hidden" name="vehicleCapacity" value={capacityAttr} />
            <input
              type="hidden"
              name="loadoutJson"
              value={JSON.stringify(
                loadout.map((L) => ({
                  // intentionally omit `key` so ESLint doesn't complain
                  productId: L.productId,
                  name: L.name,
                  qty: L.qty,
                  allowDecimal: L.allowDecimal,
                }))
              )}
            />
            {actionData && !actionData.ok ? (
              <div className="text-sm text-red-600 mr-auto">
                {actionData.error}
              </div>
            ) : null}

            <button
              name="intent"
              value="cancel"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>

            {!readOnly ? (
              <>
                <button
                  name="intent"
                  value="save"
                  className="rounded-xl bg-white border border-indigo-200 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-50"
                >
                  Save & Stay
                </button>
                <button
                  name="intent"
                  value="save-exit"
                  className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  title="Save and return to Cashier"
                >
                  Save & Exit
                </button>
                <button
                  name="intent"
                  value="dispatch"
                  disabled={!hasRider || overCapacity}
                  title={
                    !hasRider
                      ? "Choose a rider first"
                      : overCapacity
                      ? "Capacity exceeded — adjust loadout or vehicle"
                      : "Ready to dispatch (server checks coming next)"
                  }
                  className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Dispatch & Print
                </button>
              </>
            ) : (
              <button
                name="intent"
                value="reprint"
                className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm"
              >
                Reprint Ticket
              </button>
            )}
          </Form>
        </div>
      </div>
    </div>
  );
}
