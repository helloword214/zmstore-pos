/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import * as React from "react";
import { FulfillmentStatus } from "@prisma/client";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { ProductPickerHybridLoadout } from "~/components/ui/ProductPickerHybridLoadout";

// Simple built-in fallback capacities (kg) if DB profiles missing
const VEHICLE_CAPACITY_KG: Record<string, number> = {
  Tricycle: 150,
  Motorcycle: 60,
  Sidecar: 120,
  Multicab: 300,
};

// Convert measurement unit → factor to KG (schema-only; no name parsing)
function massUnitToKgFactor(raw?: string | null) {
  const u = String(raw ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.\s]/g, ""); // "kgs." -> "kgs"
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(u)) return 1;
  if (/^(g|gram|grams)$/.test(u)) return 1 / 1000;
  return 0; // liters, meters, pcs, etc. => 0 (no weight)
}

type VehicleDTO = { id: number; name: string; capacityKg: number | null };

type ProductOption = {
  id: number;
  name: string;
};

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: "PLANNED" | "DISPATCHED" | "CHECKED_IN" | "CLOSED" | "CANCELLED";
  };
  // current selection (label-based) – nullable kapag wala pang naka-set
  riderName: string | null;
  vehicleId: number | null;

  // loadout snapshot for this run (pack items only)
  loadoutSnapshot: Array<{
    productId: number | null;
    name: string;
    qty: number;
  }> | null;

  // UI helpers
  riderOptions: string[]; // labels only (alias / first+last)
  productOptions: ProductOption[];

  // product.id → kg per pack (0 if unknown)
  kgById: Record<number, number>;
  // product.id → current PACK stock
  stockById: Record<number, number>;

  vehicles: VehicleDTO[];
  categories?: string[];
  readOnly: boolean;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Store manager / admin lang pwedeng mag-dispatch ng runs
  await requireRole(request, ["ADMIN", "STORE_MANAGER"]);

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
      rider: {
        select: { alias: true, firstName: true, lastName: true },
      },
      vehicle: {
        select: { id: true, name: true, capacityUnits: true },
      },
    },
  });

  if (!run) throw new Response("Not found", { status: 404 });

  const readOnly = run.status === "DISPATCHED";

  // ── Riders (Employee role=RIDER, active) ──────────────────────────────
  const employees = await db.employee.findMany({
    where: { role: "RIDER", active: true },
    select: { id: true, alias: true, firstName: true, lastName: true },
    orderBy: [{ alias: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
  });

  const riderOptions = employees
    .map((e) =>
      (
        e.alias?.trim() || [e.firstName, e.lastName].filter(Boolean).join(" ")
      ).trim()
    )
    .filter(Boolean);

  let riderName: string | null = null;
  if (run.riderId) {
    const match = employees.find((e) => e.id === run.riderId);
    if (match) {
      riderName =
        match.alias?.trim() ||
        [match.firstName, match.lastName].filter(Boolean).join(" ") ||
        null;
    }
  }

  // ── Product catalog for loadout (PACK items only) ─────────────────────
  const packProducts = await db.product.findMany({
    where: {
      isActive: true,
      srp: { gt: 0 }, // pack price
      stock: { gt: 0 }, // may natitirang pack stock
    },
    select: {
      id: true,
      name: true,
      stock: true,
      packingSize: true,
      unit: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });

  const productOptions: ProductOption[] = packProducts.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const kgById: Record<number, number> = {};
  const stockById: Record<number, number> = {};
  for (const p of packProducts) {
    const size = Number(p.packingSize ?? 0);
    const factor = massUnitToKgFactor(p.unit?.name);
    kgById[p.id] = factor > 0 && size > 0 ? size * factor : 0;
    // importante: kahit 0 or null, gawin nating 0 para tama ang overStock check
    stockById[p.id] = Number(p.stock ?? 0);
  }

  // ── Vehicles (from DB, fallback to built-ins) ────────────────────────
  let vehicles: VehicleDTO[] = [];
  try {
    const rows = await db.vehicle.findMany({
      where: { active: true },
      select: { id: true, name: true, capacityUnits: true },
      orderBy: { name: "asc" },
    });
    vehicles = rows.map((v) => ({
      id: v.id,
      name: v.name,
      capacityKg: v.capacityUnits ?? null,
    }));
  } catch {
    vehicles = [];
  }
  if (vehicles.length === 0) {
    const fallback = Object.entries(VEHICLE_CAPACITY_KG).map(
      ([name, cap], i) => ({
        id: -1000 - i,
        name,
        capacityKg: cap,
      })
    );
    vehicles = fallback;
  }

  const loadoutSnapshot = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[]).map((row) => ({
        productId:
          row?.productId == null ? null : Number(row.productId) || null,
        name: String(row?.name ?? ""),
        qty: Number(row?.qty ?? 0) || 0,
      }))
    : null;

  // Categories with at least 1 active, pack-eligible product (for picker filter)
  const categoryRows = await db.category.findMany({
    where: {
      products: {
        some: {
          isActive: true,
          srp: { gt: 0 },
        },
      },
    },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  const data: LoaderData = {
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status as any,
    },
    riderName,
    vehicleId: run.vehicleId ?? run.vehicle?.id ?? null,
    loadoutSnapshot,
    riderOptions,
    productOptions,
    kgById,
    stockById,
    vehicles,
    categories: categoryRows.map((c) => c.name).filter(Boolean),
    readOnly,
  };

  return json(data);
}

type ActionData = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN", "STORE_MANAGER"]);

  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json<ActionData>(
      { ok: false, error: "Invalid run ID" },
      { status: 400 }
    );

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  const riderName = (String(form.get("riderName") ?? "").trim() || null) as
    | string
    | null;

  const vehicleIdRaw = form.get("vehicleId");
  const vehicleId = vehicleIdRaw ? Number(vehicleIdRaw) : null;

  const loadoutJson = String(form.get("loadoutJson") ?? "") || "[]";

  let loadoutSnapshot: Array<{
    productId: number | null;
    name: string;
    qty: number;
  }> = [];

  try {
    const parsed = JSON.parse(loadoutJson);
    if (Array.isArray(parsed)) {
      loadoutSnapshot = parsed.map((l: any) => ({
        productId: l?.productId == null ? null : Number(l.productId) || null,
        name: typeof l?.name === "string" ? l.name : "",
        qty: Math.max(0, Number(l?.qty ?? 0) || 0),
      }));
    }
  } catch {
    // ignore invalid JSON -> treat as no loadout
    loadoutSnapshot = [];
  }

  // drop <= 0 qty rows
  loadoutSnapshot = loadoutSnapshot.filter((l) => l.qty > 0);

  // Guard: any positive qty must have productId
  const badRows = loadoutSnapshot.filter(
    (l) => l.qty > 0 && (!l.productId || !Number.isFinite(l.productId))
  );
  if (badRows.length > 0) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "Loadout has items with quantity but no product selected. Please complete each row.",
      },
      { status: 400 }
    );
  }

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      status: true,
    },
  });

  if (!run) {
    return json<ActionData>(
      { ok: false, error: "Run not found" },
      { status: 404 }
    );
  }

  const isReadOnly = run.status === "DISPATCHED";

  if (intent === "cancel") {
    return redirect("/runs");
  }

  // Load all active riders, and map label → employeeId
  const employees = await db.employee.findMany({
    where: { role: "RIDER", active: true },
    select: { id: true, alias: true, firstName: true, lastName: true },
    take: 200,
  });
  const labelToId = new Map<string, number>();
  for (const e of employees) {
    const label = (
      e.alias?.trim() || [e.firstName, e.lastName].filter(Boolean).join(" ")
    ).trim();
    if (!label) continue;
    labelToId.set(label, e.id);
  }

  if (!riderName || !labelToId.has(riderName)) {
    return json<ActionData>(
      { ok: false, error: "Driver must be selected from the list." },
      { status: 400 }
    );
  }

  const riderEmployeeId = labelToId.get(riderName)!;

  // capacity guard (KG) – based on vehicleId if any
  let effectiveCapacityKg: number | null = null;
  if (vehicleId && vehicleId > 0) {
    const v = await db.vehicle.findUnique({
      where: { id: vehicleId },
      select: { active: true, capacityUnits: true },
    });
    if (!v || !v.active) {
      return json<ActionData>(
        { ok: false, error: "Invalid vehicle selected." },
        { status: 400 }
      );
    }
    effectiveCapacityKg = v.capacityUnits ?? null;
  }

  // compute kg map for posted products (loadout only, for capacity)
  const postedIds = Array.from(
    new Set(
      loadoutSnapshot
        .map((l) => (l.productId == null ? null : Number(l.productId)))
        .filter((v): v is number => Number.isFinite(v))
    )
  );

  const productsForKg =
    postedIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: postedIds } },
          select: {
            id: true,
            packingSize: true,
            unit: { select: { name: true } },
            srp: true,
          },
        })
      : [];

  const kgByIdServer = new Map<number, number>();
  for (const p of productsForKg) {
    const size = Number(p.packingSize ?? 0);
    const factor = massUnitToKgFactor(p.unit?.name);
    kgByIdServer.set(p.id, factor > 0 && size > 0 ? size * factor : 0);
  }

  const usedCapacityKg = loadoutSnapshot.reduce((sum, l) => {
    if (!l.productId) return sum;
    const kg = kgByIdServer.get(l.productId) ?? 0;
    return sum + kg * l.qty;
  }, 0);

  if (effectiveCapacityKg != null && usedCapacityKg > effectiveCapacityKg) {
    return json<ActionData>(
      {
        ok: false,
        error: "Capacity exceeded (kg). Adjust loadout or change vehicle.",
      },
      { status: 400 }
    );
  }

  switch (intent) {
    case "save":
    case "save-exit": {
      if (isReadOnly) {
        return json<ActionData>(
          { ok: false, error: "Run already dispatched (read-only)." },
          { status: 400 }
        );
      }

      await db.deliveryRun.update({
        where: { id },
        data: {
          riderId: riderEmployeeId,
          vehicleId: vehicleId && vehicleId > 0 ? vehicleId : null,
          loadoutSnapshot: loadoutSnapshot as any,
        },
      });

      if (intent === "save-exit") {
        return redirect("/runs");
      }
      return redirect(`/runs/${id}/dispatch?saved=1`);
    }

    case "revert-planned": {
      // simple guard: only allow revert if currently DISPATCHED
      if (run.status !== "DISPATCHED") {
        return json<ActionData>(
          { ok: false, error: "Run is not dispatched, cannot revert." },
          { status: 400 }
        );
      }

      await db.deliveryRun.update({
        where: { id },
        data: {
          status: "PLANNED",
          dispatchedAt: null,
        },
      });

      // balik sa staging page, now editable (readOnly = false)
      return redirect(`/runs/${id}/dispatch`);
    }

    case "dispatch": {
      if (isReadOnly) {
        return json<ActionData>({ ok: true });
      }

      // 1️⃣ Hanapin lahat ng orders na naka-link sa run na 'to
      const links = await db.deliveryRunOrder.findMany({
        where: { runId: id },
        include: {
          order: {
            select: {
              id: true,
              customerId: true,
              items: {
                select: {
                  id: true,
                  productId: true,
                  qty: true,
                  unitPrice: true,
                },
              },
            },
          },
        },
      });

      const orders = links
        .map((l) => l.order)
        .filter((o): o is NonNullable<(typeof links)[number]["order"]> => !!o);

      // 2️⃣ Collect lahat ng productId galing:
      //   - order items (retail/pack mix)
      //   - loadout (pack-only)
      const itemIds = new Set<number>();
      for (const o of orders) {
        for (const it of o.items) {
          itemIds.add(it.productId);
        }
      }
      const loadoutIds = new Set<number>();
      for (const l of loadoutSnapshot) {
        if (!l.productId) continue;
        loadoutIds.add(Number(l.productId));
      }

      const allIds = Array.from(new Set([...itemIds, ...loadoutIds]));

      const products =
        allIds.length > 0
          ? await db.product.findMany({
              where: { id: { in: allIds } },
              select: {
                id: true,
                allowPackSale: true,
                price: true, // retail
                srp: true, // pack
                stock: true,
                packingStock: true,
              },
            })
          : [];

      const byId = new Map(products.map((p) => [p.id, p]));

      // Combined deltas:
      //   pack   → product.stock
      //   retail → product.packingStock
      const deltas = new Map<number, { pack: number; retail: number }>();
      const errors: Array<{ productId: number; reason: string }> = [];

      const approxEqual = (a: number, b: number, eps = 0.25) =>
        Math.abs(a - b) <= eps;

      // 3️⃣ From ORDER ITEMS: infer RETAIL vs PACK per line, then accumulate
      for (const o of orders) {
        for (const it of o.items) {
          const p = byId.get(it.productId);
          if (!p) {
            errors.push({ productId: it.productId, reason: "Product missing" });
            continue;
          }

          const unitPrice = Number(it.unitPrice);
          const qty = Number(it.qty);
          const baseRetail = Number(p.price ?? 0);
          const basePack = Number(p.srp ?? 0);

          let inferred: "RETAIL" | "PACK" | null = null;

          // basic inference based on snapshot prices
          if (
            p.allowPackSale &&
            baseRetail > 0 &&
            approxEqual(unitPrice, baseRetail)
          ) {
            inferred = "RETAIL";
          } else if (basePack > 0 && approxEqual(unitPrice, basePack)) {
            inferred = "PACK";
          }

          // fallback: kung hindi ma-infer, treat as PACK kapag may srp
          if (!inferred && basePack > 0) {
            inferred = "PACK";
          }

          if (!inferred) {
            errors.push({
              productId: it.productId,
              reason: "Cannot infer unit kind",
            });
            continue;
          }

          const c = deltas.get(p.id) ?? { pack: 0, retail: 0 };
          if (inferred === "RETAIL") c.retail += qty;
          else c.pack += qty;
          deltas.set(p.id, c);
        }
      }

      // 4️⃣ From LOADOUT snapshot (PACK-only) → add to pack deltas
      for (const l of loadoutSnapshot) {
        if (!l.productId) continue;
        const pid = Number(l.productId);
        const q = l.qty;
        if (q <= 0) continue;
        const c = deltas.get(pid) ?? { pack: 0, retail: 0 };
        c.pack += q;
        deltas.set(pid, c);
      }

      if (errors.length) {
        return json<ActionData>(
          { ok: false, error: "Stock check failed (unit inference)." },
          { status: 400 }
        );
      }

      // 5️⃣ Final stock validation: against current PACK + RETAIL stock
      for (const [pid, c] of deltas.entries()) {
        const p = byId.get(pid);
        if (!p) continue;
        const packStock = Number(p.stock ?? 0);
        const retailStock = Number(p.packingStock ?? 0);

        if (c.pack > packStock) {
          errors.push({
            productId: pid,
            reason: `Not enough PACK stock (have ${packStock}, need ${c.pack})`,
          });
        }

        if (c.retail > retailStock) {
          errors.push({
            productId: pid,
            reason: `Not enough RETAIL stock (have ${retailStock}, need ${c.retail})`,
          });
        }
      }

      if (errors.length) {
        return json<ActionData>(
          { ok: false, error: "Insufficient stock for dispatch." },
          { status: 400 }
        );
      }

      // 6️⃣ Apply effects: products + run + linked orders
      await db.$transaction(async (tx) => {
        const now = new Date();

        // products
        for (const [pid, c] of deltas.entries()) {
          await tx.product.update({
            where: { id: pid },
            data: {
              stock: { decrement: c.pack }, // PACK
              packingStock: { decrement: c.retail }, // RETAIL
            },
          });
        }

        // run
        await tx.deliveryRun.update({
          where: { id },
          data: {
            status: "DISPATCHED",
            dispatchedAt: now,
            riderId: riderEmployeeId,
            vehicleId: vehicleId && vehicleId > 0 ? vehicleId : null,
            loadoutSnapshot: loadoutSnapshot as any,
          },
        });

        // linked orders (if any) → mark as DISPATCHED din
        for (const o of orders) {
          await tx.order.update({
            where: { id: o.id },
            data: {
              fulfillmentStatus: FulfillmentStatus.DISPATCHED,
              dispatchedAt: now,
            },
          });
        }
      });

      // 7️⃣ Redirect:
      //    - 1 linked order → straight to ticket (auto-print)
      //    - 0 or many orders → run summary
      if (orders.length === 1) {
        return redirect(
          `/orders/${orders[0].id}/ticket?autoprint=1&autoback=1`
        );
      }

      return redirect(`/runs/${id}/summary`);
    }

    default:
      return json<ActionData>(
        { ok: false, error: "Unknown intent" },
        { status: 400 }
      );
  }
}

export default function RunDispatchPage() {
  const {
    run,
    riderName: riderFromServer,
    vehicleId: vehicleIdFromServer,
    loadoutSnapshot,
    riderOptions,
    categories,
    kgById,
    stockById,
    vehicles,
    readOnly,
  } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const [sp] = useSearchParams();
  const savedFlag = sp.get("saved") === "1";
  const busy = nav.state !== "idle";

  const [riderName, setRiderName] = React.useState<string>(
    riderFromServer ?? ""
  );
  const [vehicleId, setVehicleId] = React.useState<number | null>(
    vehicleIdFromServer
  );

  type LoadLine = {
    key: string;
    productId: number | null;
    name: string;
    qty: string;
  };

  const [loadout, setLoadout] = React.useState<LoadLine[]>(
    Array.isArray(loadoutSnapshot)
      ? loadoutSnapshot.map((x) => ({
          key: crypto.randomUUID(),
          productId: x.productId ?? null,
          name: x.name ?? "",
          qty: String(Number(x.qty ?? 0) || 0),
        }))
      : []
  );

  const vehicleSelectOptions = React.useMemo(
    () => [
      { value: "", label: "— Select vehicle —" },
      ...vehicles.map((v) => ({
        value: String(v.id),
        label: v.name,
      })),
    ],
    [vehicles]
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

  const usedCapacityKg = React.useMemo(() => {
    return loadout.reduce((sum, L) => {
      if (!L.productId) return sum;
      const kg = kgMap.get(L.productId) ?? 0;
      return sum + kg * qtyNum(L.qty);
    }, 0);
  }, [loadout, kgMap]);

  const capacityKg = React.useMemo(() => {
    if (vehicleId == null) return null;
    return vehicles.find((v) => v.id === vehicleId)?.capacityKg ?? null;
  }, [vehicleId, vehicles]);

  const overCapacity =
    capacityKg != null && usedCapacityKg > capacityKg && capacityKg > 0;

  const serializedLoadout = React.useMemo(() => {
    const clean = loadout
      .filter(
        (L) =>
          qtyNum(L.qty) > 0 &&
          L.productId != null &&
          Number.isFinite(L.productId)
      )
      .map((L) => ({
        productId: Number(L.productId),
        name: L.name,
        qty: qtyNum(L.qty),
      }));
    return JSON.stringify(clean);
  }, [loadout]);

  const disableAll = busy || readOnly;
  const hasRider = riderName.trim().length > 0;

  const overStock = React.useMemo(() => {
    return loadout.some((L) => {
      if (!L.productId) return false;
      const pid = Number(L.productId);
      const q = qtyNum(L.qty);
      const stock = stockMap.get(pid) || 0;
      return q > stock;
    });
  }, [loadout, stockMap]);

  const totalLoadUnits = React.useMemo(
    () =>
      loadout.reduce((s, L) => {
        if (!L.productId) return s;
        return s + qtyNum(L.qty);
      }, 0),
    [loadout]
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl p-5">
        <div className="mb-3">
          <Link to="/runs" className="text-sm text-indigo-600 hover:underline">
            ← Back to Runs
          </Link>
        </div>

        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Dispatch Staging —{" "}
              <span className="font-mono text-indigo-700">{run.runCode}</span>
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {readOnly
                ? "Already dispatched (read-only)."
                : "Assign rider, vehicle, and loadout before dispatch."}
            </p>
          </div>
          <div className="text-xs">
            <span
              className={`rounded-full border px-2 py-1 ${
                run.status === "DISPATCHED"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {run.status}
            </span>
          </div>
        </header>

        {savedFlag && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Staging saved.
          </div>
        )}

        {actionData && !actionData.ok && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionData.error}
          </div>
        )}

        <div className="grid gap-4">
          {/* Rider */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-800">
                Driver <span className="text-rose-600">*</span>
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
              <div className="text-sm text-slate-800">
                {riderFromServer ?? "—"}
              </div>
            ) : (
              <div className="grid gap-1">
                <SelectInput
                  options={[
                    { value: "__", label: "— Select driver —" },
                    ...riderOptions.map((r) => ({ value: r, label: r })),
                  ]}
                  value={riderName || "__"}
                  onChange={(val) => {
                    setRiderName(val === "__" ? "" : String(val));
                  }}
                  className={disableAll ? "opacity-70 pointer-events-none" : ""}
                />
              </div>
            )}
          </div>

          {/* Vehicle + capacity */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-800">
                Vehicle <span className="text-slate-400">(optional)</span>
              </div>
              {vehicleId != null && capacityKg != null && (
                <span className="text-xs text-slate-600">
                  Capacity: {capacityKg} kg
                </span>
              )}
            </div>
            {readOnly ? (
              <div className="text-sm text-slate-800">
                {vehicleId != null
                  ? vehicles.find((v) => v.id === vehicleId)?.name ?? "—"
                  : "—"}
              </div>
            ) : (
              <SelectInput
                options={vehicleSelectOptions}
                value={vehicleId == null ? "" : String(vehicleId)}
                onChange={(val) => setVehicleId(val ? Number(val) : null)}
                className={disableAll ? "opacity-70 pointer-events-none" : ""}
              />
            )}
          </div>

          {/* Loadout */}
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <div className="text-sm font-medium text-slate-800">Loadout</div>
              <div className="text-xs text-slate-600">
                Total units:{" "}
                <span className="font-semibold">{totalLoadUnits}</span>
                {" · "}
                Used KG:{" "}
                <span
                  className={
                    overCapacity
                      ? "text-rose-600 font-semibold"
                      : "font-semibold"
                  }
                >
                  {Math.round(usedCapacityKg)}
                  {capacityKg != null ? ` / ${capacityKg}` : ""}
                </span>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {overCapacity && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Capacity exceeded (kg). Adjust loadout or choose a different
                  vehicle.
                </div>
              )}
              {overStock && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  One or more lines exceed available stock.
                </div>
              )}

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
                  disabled={disableAll}
                >
                  + Add row
                </button>
              )}

              <div className="grid gap-2">
                {loadout.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    {readOnly ? "No loadout data." : "No loadout yet."}
                  </div>
                ) : (
                  loadout.map((L) => {
                    const stock =
                      L.productId != null ? stockMap.get(L.productId) ?? 0 : 0;
                    const qNum = qtyNum(L.qty);
                    const isOver = L.productId != null && qNum > stock;

                    return (
                      <div
                        key={L.key}
                        className={`grid grid-cols-12 gap-2 rounded-xl border px-2 py-2 ${
                          isOver
                            ? "border-amber-300 bg-amber-50/60"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="col-span-12 sm:col-span-7">
                          {readOnly ? (
                            <div className="text-sm text-slate-800 truncate">
                              {L.productId ? `#${L.productId} — ` : ""}
                              {L.name || "—"}
                            </div>
                          ) : (
                            <ProductPickerHybridLoadout
                              defaultValue={
                                L.productId
                                  ? { id: L.productId, name: L.name }
                                  : null
                              }
                              placeholder="Type ID or name…"
                              disabled={disableAll}
                              categoryOptions={categories ?? []}
                              onSelect={(p) => {
                                setLoadout((prev) =>
                                  prev.map((x) =>
                                    x.key === L.key
                                      ? {
                                          ...x,
                                          productId: p.id,
                                          name: p.name,
                                        }
                                      : x
                                  )
                                );
                              }}
                            />
                          )}
                          {L.productId != null && (
                            <div className="mt-1 text-[11px] text-slate-500">
                              Stock:{" "}
                              <span className="tabular-nums">
                                {stockMap.get(L.productId) ?? 0}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="col-span-8 sm:col-span-3">
                          {readOnly ? (
                            <div className="text-right text-sm">{L.qty}</div>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={L.qty}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setLoadout((prev) =>
                                  prev.map((x) =>
                                    x.key === L.key ? { ...x, qty: raw } : x
                                  )
                                );
                              }}
                              onBlur={() => {
                                setLoadout((prev) =>
                                  prev.reduce<LoadLine[]>((acc, x) => {
                                    if (x.key !== L.key) {
                                      acc.push(x);
                                      return acc;
                                    }
                                    const n = qtyNum(x.qty);
                                    if (n <= 0) return acc;
                                    const fixed = Math.round(n);
                                    if (fixed <= 0) return acc;
                                    acc.push({ ...x, qty: String(fixed) });
                                    return acc;
                                  }, [])
                                );
                              }}
                              className="h-10 w-full max-w-[7rem] rounded-md border border-slate-300 bg-white px-3 text-sm text-right outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                            />
                          )}
                          {isOver && (
                            <div className="mt-1 text-[11px] text-amber-700 text-right">
                              Exceeds stock ({stock})
                            </div>
                          )}
                        </div>

                        <div className="col-span-4 sm:col-span-2 text-right">
                          {!readOnly && (
                            <button
                              type="button"
                              disabled={disableAll}
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
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <Form
            method="post"
            replace
            className={`mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end ${
              busy ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            <input type="hidden" name="riderName" value={riderName} />
            <input type="hidden" name="vehicleId" value={vehicleId ?? ""} />
            <input type="hidden" name="loadoutJson" value={serializedLoadout} />

            <button
              name="intent"
              value="cancel"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              type="submit"
            >
              Cancel
            </button>

            {!readOnly ? (
              <>
                <button
                  name="intent"
                  value="save"
                  type="submit"
                  className="rounded-xl bg-white border border-indigo-200 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-50"
                >
                  Save & Stay
                </button>
                <button
                  name="intent"
                  value="save-exit"
                  type="submit"
                  className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Save & Exit
                </button>
                <button
                  name="intent"
                  value="dispatch"
                  type="submit"
                  disabled={
                    !hasRider ||
                    overCapacity ||
                    overStock ||
                    loadout.length === 0
                  }
                  title={
                    !hasRider
                      ? "Choose a driver first"
                      : overCapacity
                      ? "Capacity exceeded (kg)"
                      : overStock
                      ? "One or more lines exceed available stock"
                      : loadout.length === 0
                      ? "Add at least one loadout line"
                      : "Ready to dispatch"
                  }
                  className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Dispatch
                </button>
              </>
            ) : (
              <button
                name="intent"
                value="revert-planned"
                type="submit"
                className="rounded-xl bg-amber-600 text-white px-4 py-2 text-sm hover:bg-amber-700"
              >
                Revert to Planned
              </button>
            )}
          </Form>
        </div>
      </div>
    </main>
  );
}
