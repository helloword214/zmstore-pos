/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { ProductPickerHybridLoadout } from "~/components/ui/ProductPickerHybridLoadout";

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: "PLANNED" | "DISPATCHED" | "CLOSED" | "CANCELLED";
    riderId: number | null;
    vehicleId: number | null;
    loadoutSnapshot: Array<{
      productId: number;
      name: string;
      qty: number;
    }> | null;
  };
  riders: Array<{ id: number; label: string }>;
  vehicles: Array<{ id: number; name: string; capacityKg: number | null }>;
  // PACK catalog (srp>0; stock>0)
  productOptions: Array<{ id: number; name: string; srp: number }>;
  // product.id -> kg per pack (0 if unknown)
  kgById: Record<number, number>;
  // product.id -> current PACK stock (for max qty guard)
  stockById: Record<number, number>;
  categoryOptions: string[];
  readOnly: boolean;
};

// Schema-only mass conversion: measurement unit -> factor to KG (no name parsing)
function massUnitToKgFactor(raw?: string | null) {
  const u = String(raw ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.\s]/g, "");
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(u)) return 1;
  if (/^(g|gram|grams)$/.test(u)) return 1 / 1000;
  return 0; // liters, meters, pcs, etc. => 0 (no weight)
}

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
      vehicleId: true,
      loadoutSnapshot: true,
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });
  if (run.status === "CANCELLED")
    throw new Response("Run cancelled", { status: 400 });

  const employees = await db.employee.findMany({
    where: { role: "RIDER", active: true },
    select: { id: true, firstName: true, lastName: true, alias: true },
    orderBy: [{ alias: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  const riders = employees.map((e) => ({
    id: e.id,
    label: (e.alias?.trim() ||
      [e.firstName, e.lastName].filter(Boolean).join(" ") ||
      `#${e.id}`)!,
  }));

  const vehiclesRaw = await db.vehicle.findMany({
    where: { active: true },
    select: { id: true, name: true, capacityUnits: true },
    orderBy: { name: "asc" },
  });
  const vehicles = vehiclesRaw.map((v) => ({
    id: v.id,
    name: v.name,
    capacityKg: v.capacityUnits ?? null,
  }));

  const packProducts = await db.product.findMany({
    where: { isActive: true, srp: { gt: 0 }, stock: { gt: 0 } },
    select: {
      id: true,
      name: true,
      srp: true,
      packingSize: true,
      unit: { select: { name: true } }, // measurement unit (kg/g/…)
    },
    orderBy: { name: "asc" },
    take: 800,
  });
  const productOptions = packProducts.map((p) => ({
    id: p.id,
    name: p.name,
    srp: Number(p.srp ?? 0),
  }));

  // Build kg/stock maps using union of: existing loadout snapshot + picker products
  const snapshotRaw: any[] = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[])
    : [];
  const snapshotIds = snapshotRaw
    .map((x) => Number(x?.productId))
    .filter((n) => Number.isFinite(n));
  const pickerIds = packProducts.map((p) => p.id);
  const relevantIds = Array.from(new Set([...snapshotIds, ...pickerIds]));
  const productsForKgMap =
    relevantIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: relevantIds } },
          select: {
            id: true,
            packingSize: true,
            unit: { select: { name: true } },
            stock: true,
          },
        })
      : [];
  const kgById: Record<number, number> = {};
  const stockById: Record<number, number> = {};
  for (const p of productsForKgMap) {
    const size = Number(p.packingSize ?? 0);
    const factor = massUnitToKgFactor(p.unit?.name);
    kgById[p.id] = factor > 0 && size > 0 ? size * factor : 0;
    stockById[p.id] = Number(p.stock ?? 0);
  }

  // ✅ Categories from DB (graceful fallback kung walang table/relasyon)
  let categoryOptions: string[] = [];
  try {
    // Primary: kung meron kayong `category` table
    // (use (db as any) para hindi mag-type error kung wala sa schema)
    const cats =
      ((await (db as any)?.category?.findMany?.({
        select: { name: true },
        orderBy: { name: "asc" },
      })) as Array<{ name: string }>) ?? [];
    // match working page: plain, deduped names only
    const names = Array.from(new Set(cats.map((c) => c.name).filter(Boolean)));
    categoryOptions = names;
  } catch {
    // Optional alt: kung categories naka-embed sa ibang entity,
    // pwede mong palitan ito to match your schema (e.g. brand, productGroup, etc.)
    categoryOptions = [];
  }

  const readOnly = run.status === "DISPATCHED" || run.status === "CLOSED";
  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status as any,
      riderId: run.riderId,
      vehicleId: run.vehicleId,
      loadoutSnapshot: Array.isArray(run.loadoutSnapshot)
        ? (run.loadoutSnapshot as any)
        : null,
    },
    riders,
    vehicles,
    productOptions,
    kgById,
    stockById,
    categoryOptions,
    readOnly,
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
    select: { id: true, status: true },
  });
  if (!run)
    return json<ActionData>({ ok: false, error: "Not found" }, { status: 404 });
  if (run.status === "CLOSED" || run.status === "CANCELLED") {
    return json<ActionData>(
      { ok: false, error: "Run is locked." },
      { status: 400 }
    );
  }

  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const riderId = fd.get("riderId") ? Number(fd.get("riderId")) : null;
  const vehicleId = fd.get("vehicleId") ? Number(fd.get("vehicleId")) : null;
  const vehicleCapacity = fd.get("vehicleCapacity")
    ? Number(fd.get("vehicleCapacity"))
    : null;
  const loadoutJson = String(fd.get("loadoutJson") || "[]");

  type LoadLine = { productId: number | null; name: string; qty: number };
  let loadout: LoadLine[] = [];
  try {
    const parsed = JSON.parse(loadoutJson);
    if (Array.isArray(parsed)) {
      loadout = parsed
        .map((l) => ({
          productId: l?.productId == null ? null : Number(l.productId),
          name: typeof l?.name === "string" ? l.name : "",
          qty: Math.max(0, Math.floor(Number(l?.qty ?? 0))),
        }))
        .filter(
          (l) =>
            (l.qty > 0 && Number.isFinite(Number(l.productId))) || l.qty === 0
        );
    }
  } catch {}
  // keep only positive-qty rows with valid product
  loadout = loadout.filter(
    (l) => l.qty > 0 && Number.isFinite(l.productId as any)
  );

  // validate rider (required for dispatch; optional for save)
  if (intent === "dispatch") {
    if (!Number.isFinite(riderId as any) || !riderId) {
      return json<ActionData>(
        { ok: false, error: "Select a rider." },
        { status: 400 }
      );
    }
    const rider = await db.employee.findUnique({
      where: { id: riderId! },
      select: { active: true, role: true },
    });
    if (!rider || !rider.active || rider.role !== "RIDER") {
      return json<ActionData>(
        { ok: false, error: "Invalid rider." },
        { status: 400 }
      );
    }
  }

  // collect posted product ids
  const pids = Array.from(
    new Set(loadout.map((l) => Number(l.productId)))
  ).filter((n) => Number.isFinite(n)) as number[];

  // guard: PACK-only (srp > 0)
  if (pids.length) {
    const rows = await db.product.findMany({
      where: { id: { in: pids } },
      select: { id: true, srp: true, name: true, stock: true },
    });
    const invalid = rows
      .filter((r) => Number(r.srp ?? 0) <= 0)
      .map((r) => r.id);
    if (invalid.length) {
      return json<ActionData>(
        { ok: false, error: "Loadout can include PACK/whole items only." },
        { status: 400 }
      );
    }
  }

  // capacity check (use client-hinted vehicleCapacity; optional)
  if (vehicleCapacity != null) {
    // compute used kg from DB schema (measurement unit -> kg), schema-only
    const products = pids.length
      ? await db.product.findMany({
          where: { id: { in: pids } },
          select: {
            id: true,
            packingSize: true,
            unit: { select: { name: true } },
          },
        })
      : [];

    const kgByIdServer = new Map<number, number>();
    for (const p of products) {
      const size = Number(p.packingSize ?? 0);
      const factor = massUnitToKgFactor(p.unit?.name);
      kgByIdServer.set(p.id, factor > 0 && size > 0 ? size * factor : 0);
    }

    const usedKg = loadout.reduce(
      (s, l) => s + (kgByIdServer.get(Number(l.productId)) ?? 0) * l.qty,
      0
    );

    if (usedKg > vehicleCapacity) {
      return json<ActionData>(
        {
          ok: false,
          error: "Capacity exceeded (kg). Adjust loadout or vehicle.",
        },
        { status: 400 }
      );
    }
  }

  if (intent === "save") {
    await db.deliveryRun.update({
      where: { id },
      data: {
        riderId: riderId ?? undefined,
        vehicleId: vehicleId ?? undefined,
        loadoutSnapshot: loadout as any,
      },
    });
    return redirect(`/runs/${id}/dispatch?saved=1`);
  }

  if (intent === "dispatch") {
    // stock checks and movements
    const byPidQty = new Map<number, number>();
    for (const l of loadout) {
      const pid = Number(l.productId);
      byPidQty.set(pid, (byPidQty.get(pid) || 0) + Number(l.qty));
    }
    const products = (await db.product.findMany({
      where: { id: { in: Array.from(byPidQty.keys()) } },
      select: { id: true, name: true, stock: true },
    })) as Array<{ id: number; name: string; stock: number | null }>;
    const stockErrors: string[] = [];
    for (const p of products) {
      const need = byPidQty.get(p.id)!;
      const have = Number(p.stock ?? 0);
      if (need > have)
        stockErrors.push(`• ${p.name}: have ${have}, need ${need}`);
    }
    if (stockErrors.length) {
      return json<ActionData>(
        { ok: false, error: "Insufficient stock:\n" + stockErrors.join("\n") },
        { status: 400 }
      );
    }

    await db.$transaction(async (tx) => {
      // decrement stock + create LOADOUT_OUT movements
      for (const [pid, q] of byPidQty.entries()) {
        await tx.product.update({
          where: { id: pid },
          data: { stock: { decrement: q } },
        });
        await tx.stockMovement.create({
          data: {
            type: "LOADOUT_OUT",
            productId: pid,
            qty: q,
            refKind: "RUN",
            refId: id,
            notes: "Run dispatch",
          },
        });
      }
      await tx.deliveryRun.update({
        where: { id },
        data: {
          riderId: riderId ?? undefined,
          vehicleId: vehicleId ?? undefined,
          loadoutSnapshot: loadout as any,
          status: "DISPATCHED",
          dispatchedAt: new Date(),
        },
      });
    });
    return redirect(`/runs/${id}/remit`);
  }

  // cancel/back
  return redirect("/runs");
}

export default function RunDispatchPage() {
  const {
    run,
    riders,
    vehicles,
    productOptions,
    kgById,
    stockById,
    categoryOptions,
    readOnly,
  } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const busy = nav.state !== "idle";

  // local state
  const [riderId, setRiderId] = React.useState<string>(
    run.riderId ? String(run.riderId) : ""
  );
  const [vehicleId, setVehicleId] = React.useState<string>(
    run.vehicleId ? String(run.vehicleId) : ""
  );
  const capacity = React.useMemo(() => {
    const v = vehicles.find((x) => String(x.id) === vehicleId);
    return v?.capacityKg ?? null;
  }, [vehicleId, vehicles]);

  type LoadLine = {
    key: string;
    productId: number | null;
    name: string;
    qty: string;
  };
  const [loadout, setLoadout] = React.useState<LoadLine[]>(
    Array.isArray(run.loadoutSnapshot)
      ? run.loadoutSnapshot.map((l: any) => ({
          key: crypto.randomUUID(),
          productId: Number(l.productId),
          name: String(l.name),
          qty: String(Number(l.qty)),
        }))
      : []
  );
  const qtyNum = (q: string | number) => {
    const n = typeof q === "number" ? q : parseFloat(q);
    return Number.isFinite(n) ? n : 0;
  };
  const kgMap = React.useMemo(
    () =>
      new Map<number, number>(
        Object.entries(kgById).map(([k, v]) => [Number(k), Number(v) || 0])
      ),
    [kgById]
  );

  const stockMap = React.useMemo(
    () =>
      new Map<number, number>(
        Object.entries(stockById).map(([k, v]) => [Number(k), Number(v) || 0])
      ),
    [stockById]
  );
  const qtyByProductId = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const L of loadout) {
      if (!L.productId) continue;
      const pid = Number(L.productId);
      const q = qtyNum(L.qty);
      m.set(pid, (m.get(pid) || 0) + q);
    }
    return m;
  }, [loadout]);

  const usedCapacityKg = React.useMemo(
    () =>
      loadout.reduce((sum, L) => {
        if (!L.productId) return sum;
        const kg = kgMap.get(L.productId) ?? 0;
        return sum + kg * qtyNum(L.qty);
      }, 0),
    [loadout, kgMap]
  );
  const overCapacity = capacity != null && usedCapacityKg > capacity;
  const packOnlyIdSet = React.useMemo(
    () => new Set(productOptions.map((p) => p.id)),
    [productOptions]
  );

  const hasUnboundLoad = React.useMemo(
    () => loadout.some((L) => qtyNum(L.qty) > 0 && !L.productId),
    [loadout]
  );
  const hasOverStock = React.useMemo(() => {
    return loadout.some((L) => {
      if (!L.productId) return false;
      const pid = Number(L.productId);
      const q = qtyNum(L.qty);
      const stock = stockMap.get(pid) || 0;
      return q > stock;
    });
  }, [loadout, stockMap]);
  const willExceedWith = React.useCallback(
    (productId: number, deltaQty = 1) => {
      // capacity check
      if (capacity != null) {
        const kg = kgMap.get(productId) ?? 0;
        if (usedCapacityKg + kg * deltaQty > capacity) return true;
      }
      // stock check
      const inCart = qtyByProductId.get(productId) || 0;
      const stock = stockMap.get(productId) || 0;
      return inCart + deltaQty > stock;
    },
    [capacity, usedCapacityKg, kgMap, qtyByProductId, stockMap]
  );
  const serializedLoadout = React.useMemo(
    () =>
      JSON.stringify(
        loadout
          .filter(
            (L) => qtyNum(L.qty) > 0 && Number.isFinite(Number(L.productId))
          )
          .map((L) => ({
            productId: Number(L.productId),
            name: L.name,
            qty: Math.floor(qtyNum(L.qty)),
          }))
      ),
    [loadout]
  );

  return (
    <div className="mx-auto p-3 md:p-6 min-h-screen bg-[#f7f7fb]">
      <div className="mb-3">
        <Link to={"/runs"} className="text-sm text-indigo-600 hover:underline">
          ← Back to Runs
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4 md:p-5">
          <h1 className="text-lg md:text-xl font-semibold text-slate-900">
            Run Dispatch —{" "}
            <span className="font-mono text-indigo-700">{run.runCode}</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {readOnly
              ? "Already dispatched / closed."
              : "Stage rider loadout then dispatch."}
          </p>
        </div>

        {actionData && !actionData.ok && (
          <div
            className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 whitespace-pre-line"
            aria-live="polite"
          >
            {actionData.error}
          </div>
        )}

        <div className="p-4 md:p-5 grid gap-4">
          {/* Rider */}
          <div
            className="rounded-xl border border-slate-200 p-3"
            role="group"
            aria-labelledby="rider-label"
          >
            <div className="flex items-center justify-between mb-2">
              <span
                id="rider-label"
                className="text-sm font-medium text-slate-800"
              >
                Rider <span className="text-rose-600">*</span>
              </span>
            </div>
            <div className="grid gap-1">
              <SelectInput
                options={[
                  { value: "", label: "— Select rider —" },
                  ...riders.map((r) => ({
                    value: String(r.id),
                    label: r.label,
                  })),
                ]}
                value={riderId}
                onChange={(v) => setRiderId(String(v))}
                className={
                  busy || readOnly ? "opacity-70 pointer-events-none" : ""
                }
              />
              <input
                type="hidden"
                name="riderId"
                value={riderId}
                form="run-dispatch-form"
              />
            </div>
          </div>

          {/* Vehicle */}
          <div
            className="rounded-xl border border-slate-200 p-3"
            role="group"
            aria-labelledby="vehicle-label"
          >
            <div className="flex items-center justify-between mb-2">
              <span
                id="vehicle-label"
                className="text-sm font-medium text-slate-800"
              >
                Vehicle <span className="text-slate-400">(optional)</span>
              </span>
              {vehicleId ? (
                <span className="text-xs text-slate-600">
                  {capacity != null
                    ? `Capacity: Max load ${capacity} kg`
                    : "No capacity profile"}
                </span>
              ) : null}
            </div>
            <div className="grid gap-1">
              <SelectInput
                options={[
                  { value: "", label: "— Select vehicle —" },
                  ...vehicles.map((v) => ({
                    value: String(v.id),
                    label: v.name,
                  })),
                ]}
                value={vehicleId}
                onChange={(v) => setVehicleId(String(v))}
                className={
                  busy || readOnly ? "opacity-70 pointer-events-none" : ""
                }
              />
              <input
                type="hidden"
                name="vehicleId"
                value={vehicleId}
                form="run-dispatch-form"
              />
            </div>
          </div>

          {/* Loadout */}
          <div className="rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <div className="text-sm font-medium text-slate-800">
                Loadout (PACK only)
              </div>
              <div className="min-w-[180px]">
                <div
                  className={`text-xs font-medium ${
                    overCapacity ? "text-rose-700" : "text-slate-600"
                  }`}
                >
                  Used / Max (kg):{" "}
                  <span
                    className={`${
                      overCapacity ? "text-rose-700" : "text-slate-900"
                    }`}
                  >
                    {Math.round(usedCapacityKg)}{" "}
                    {capacity != null ? ` / ${capacity}` : " / —"}
                  </span>
                </div>
                {/* capacity progress bar */}
                <div className="mt-1 h-2 w-40 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-2 ${
                      overCapacity ? "bg-rose-500" : "bg-indigo-500"
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        capacity ? (usedCapacityKg / capacity) * 100 : 0
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {/* add row */}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() =>
                    setLoadout((prev) => [
                      ...prev,
                      {
                        key: crypto.randomUUID(),
                        productId: null,
                        name: "",
                        qty: "1",
                      },
                    ])
                  }
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  + Add row
                </button>
              )}

              <div className="grid gap-2">
                {loadout.length === 0 ? (
                  <div className="text-sm text-slate-500">No loadout yet.</div>
                ) : (
                  loadout.map((L) => (
                    <div
                      key={L.key}
                      className="grid grid-cols-12 gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2"
                    >
                      <div className="col-span-12 sm:col-span-8">
                        <ProductPickerHybridLoadout
                          defaultValue={
                            L.productId
                              ? { id: L.productId, name: L.name }
                              : null
                          }
                          placeholder="Type ID or name…"
                          disabled={busy || readOnly}
                          // ignore non-product rows (e.g., category headers)
                          filterRow={(p: any) =>
                            p &&
                            typeof p.id === "number" &&
                            packOnlyIdSet.has(Number(p.id))
                          }
                          categoryOptions={categoryOptions}
                          onSelect={(p: any) => {
                            // guard: only act on real product rows
                            if (!p || typeof p.id !== "number") return;
                            setLoadout((prev) =>
                              prev.map((x) =>
                                x.key === L.key
                                  ? {
                                      ...x,
                                      productId: Number(p.id),
                                      name: String(p.name ?? ""),
                                      qty: qtyNum(x.qty) > 0 ? x.qty : "1",
                                    }
                                  : x
                              )
                            );
                          }}
                        />

                        {L.productId ? (
                          <div className="text-[11px] text-slate-500 mt-1">
                            <span>Stock: {stockMap.get(L.productId) ?? 0}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="col-span-8 sm:col-span-3">
                        <div className="flex items-stretch justify-start sm:justify-end gap-1 w-full">
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            title="Decrease quantity"
                            disabled={busy || readOnly || qtyNum(L.qty) <= 0}
                            onClick={() =>
                              setLoadout((prev) =>
                                prev.map((x) =>
                                  x.key === L.key
                                    ? {
                                        ...x,
                                        qty: String(
                                          Math.max(
                                            0,
                                            Math.floor(qtyNum(x.qty) - 1)
                                          )
                                        ),
                                      }
                                    : x
                                )
                              )
                            }
                            className="h-10 w-10 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 shrink-0"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            step="1"
                            value={L.qty}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                setLoadout((prev) =>
                                  prev.map((x) =>
                                    x.key === L.key ? { ...x, qty: "" } : x
                                  )
                                );
                                return;
                              }
                              const cleaned = raw.replace(/[^\d]/g, "");
                              setLoadout((prev) =>
                                prev.map((x) =>
                                  x.key === L.key ? { ...x, qty: cleaned } : x
                                )
                              );
                            }}
                            onBlur={() => {
                              // normalize + clamp to stock + drop if 0
                              setLoadout((prev) =>
                                prev.reduce<LoadLine[]>((acc, x) => {
                                  if (x.key !== L.key) {
                                    acc.push(x);
                                    return acc;
                                  }
                                  const pid = Number(x.productId);
                                  let q = qtyNum(x.qty);
                                  if (q <= 0) return acc;
                                  const totalStock = stockMap.get(pid) || 0;
                                  // qty in other rows of same product
                                  const others = prev
                                    .filter(
                                      (o) =>
                                        o.key !== x.key && o.productId === pid
                                    )
                                    .reduce((s, o) => s + qtyNum(o.qty), 0);
                                  const maxForThisRow = Math.max(
                                    0,
                                    totalStock - others
                                  );
                                  q = Math.min(q, maxForThisRow);
                                  const fixed = Math.floor(q);
                                  if (fixed <= 0) return acc;
                                  acc.push({ ...x, qty: String(fixed) });
                                  return acc;
                                }, [])
                              );
                            }}
                            inputMode="numeric"
                            className="h-10 w-full max-w-[7rem] rounded-md border border-slate-300 bg-white px-3 text-sm text-right outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            id={`qty-${L.key}`}
                            aria-describedby={
                              capacity != null ? "capacity-hint" : undefined
                            }
                          />
                          {/* sr-only label to associate with the numeric input */}
                          <label htmlFor={`qty-${L.key}`} className="sr-only">
                            Quantity
                          </label>
                          <button
                            aria-label="Increase quantity"
                            title="Increase quantity"
                            type="button"
                            disabled={
                              busy ||
                              readOnly ||
                              (L.productId != null &&
                                willExceedWith(Number(L.productId), 1))
                            }
                            onClick={() =>
                              setLoadout((prev) =>
                                prev.map((x) =>
                                  x.key === L.key
                                    ? {
                                        ...x,
                                        qty: String(
                                          Math.floor(qtyNum(x.qty) + 1)
                                        ),
                                      }
                                    : x
                                )
                              )
                            }
                            className="h-10 w-10 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 shrink-0"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="col-span-4 sm:col-span-1 text-right">
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              setLoadout((prev) =>
                                prev.filter((x) => x.key !== L.key)
                              )
                            }
                            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                            aria-label="Remove row"
                            title="Remove row"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          {/* capacity hint for aria-describedby when vehicle chosen */}
          {capacity != null && (
            <p id="capacity-hint" className="sr-only">
              Vehicle capacity limit in kilograms.
            </p>
          )}

          {/* Actions */}
          <Form
            id="run-dispatch-form"
            method="post"
            replace
            className={`flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end ${
              busy ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            <input type="hidden" name="loadoutJson" value={serializedLoadout} />
            <input
              type="hidden"
              name="vehicleCapacity"
              value={capacity == null ? "" : String(capacity)}
            />
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
                  value="dispatch"
                  disabled={
                    !riderId || overCapacity || hasUnboundLoad || hasOverStock
                  }
                  title={
                    !riderId
                      ? "Choose a rider first"
                      : overCapacity
                      ? "Capacity exceeded (kg)"
                      : hasUnboundLoad
                      ? "Complete the loadout: select products for lines with quantity"
                      : hasOverStock
                      ? "One or more lines exceed available stock"
                      : "Ready to dispatch"
                  }
                  className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Dispatch
                </button>
              </>
            ) : null}
          </Form>
        </div>
      </div>
    </div>
  );
}
