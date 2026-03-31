import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import * as React from "react";
import { FulfillmentStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { ProductPickerHybridLoadout } from "~/components/ui/ProductPickerHybridLoadout";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { loadActiveDeliveryRunLinksByOrderIds } from "~/services/delivery-run-assignment.server";

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

type LoadoutSnapshotRow = {
  productId: number | null;
  name: string;
  qty: number;
};

type DispatchUnitKind = "PACK" | "RETAIL";

type LinkedParentOrderItemRow = {
  productId: number;
  name: string;
  qty: number;
  unitKind: DispatchUnitKind;
};

type LinkedParentOrderRow = {
  orderId: number;
  orderCode: string;
  customerLabel: string | null;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus | null;
  itemCount: number;
  totalQty: number;
  items: LinkedParentOrderItemRow[];
};

type DispatchAvailabilityRow = {
  pack: number;
  retail: number;
  allowPackSale: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const parseLoadoutSnapshotRow = (value: unknown): LoadoutSnapshotRow | null => {
  if (!isRecord(value)) return null;
  return {
    productId:
      value.productId == null ? null : Number(value.productId) || null,
    name: String(value.name ?? ""),
    qty: Number(value.qty ?? 0) || 0,
  };
};

const toLoadoutSnapshotJson = (
  rows: LoadoutSnapshotRow[]
): Prisma.InputJsonValue =>
  rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    qty: row.qty,
  }));

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: string;
  };
  // current selection (label-based) – nullable kapag wala pang naka-set
  riderName: string | null;
  vehicleId: number | null;

  // loadout snapshot for this run (pack items only)
  loadoutSnapshot: LoadoutSnapshotRow[] | null;

  // UI helpers
  riderOptions: string[]; // labels only (alias / first+last)
  productOptions: ProductOption[];

  // product.id → kg per pack (0 if unknown)
  kgById: Record<number, number>;
  // product.id → current PACK stock
  stockById: Record<number, number>;
  dispatchAvailabilityById: Record<number, DispatchAvailabilityRow>;

  vehicles: VehicleDTO[];
  categories?: string[];
  readOnly: boolean;

  // Parent orders (PAD) linked to this run (read-only clarity)
  parentOrdersSummary: {
    orderCount: number;
    uniqueItemCount: number; // unique productIds across linked orders
    totalQty: number; // sum of qty across linked order items
  } | null;

  // Optional small preview list (top few items)
  parentOrderTopItems: Array<{
    productId: number;
    name: string;
    qty: number;
  }>;
  linkedParentOrders: LinkedParentOrderRow[];
};

function resolveDispatchUnitKind(input: {
  storedKind: unknown;
  qty: number;
  allowPackSale: boolean;
}): DispatchUnitKind {
  if (input.storedKind === "RETAIL" || input.storedKind === "PACK") {
    return input.storedKind;
  }

  if (input.allowPackSale && !Number.isInteger(input.qty)) {
    return "RETAIL";
  }

  return "PACK";
}

function makeDispatchDemandKey(productId: number, unitKind: DispatchUnitKind) {
  return `${productId}:${unitKind}`;
}

// Aggregate loadout rows by productId (sum qty). Keeps a stable canonical shape.
function aggregateLoadoutSnapshot(
  rows: Array<{ productId: number | null; name: string; qty: number }>
) {
  const map = new Map<
    number,
    { productId: number; name: string; qty: number }
  >();
  for (const r of rows) {
    const pid = r.productId;
    const qty = Math.max(0, Number(r.qty) || 0);
    if (!pid || !Number.isFinite(pid) || qty <= 0) continue;
    const cur = map.get(pid);
    if (cur) {
      cur.qty += qty;
      // keep existing name (we'll canonicalize on server later)
    } else {
      map.set(pid, { productId: pid, name: String(r.name ?? ""), qty });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.productId - b.productId);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Store manager lane only
  await requireRole(request, ["STORE_MANAGER"]);

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

  // Editable ONLY while PLANNED.
  // Once DISPATCHED/CHECKED_IN/CLOSED/SETTLED/CANCELLED → lock staging.
  const readOnly = run.status !== "PLANNED";

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
      packingUnit: { select: { name: true } },
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
    const factor = massUnitToKgFactor(p.packingUnit?.name);
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
    ? run.loadoutSnapshot
        .map(parseLoadoutSnapshotRow)
        .filter((row): row is LoadoutSnapshotRow => !!row)
    : null;

  // Even if old data had duplicates, we display aggregated for sanity.
  const loadoutSnapshotAgg = loadoutSnapshot
    ? aggregateLoadoutSnapshot(loadoutSnapshot)
    : null;

  // ── Parent Orders (linked via deliveryRunOrder) ──────────────────────
  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    select: {
      order: {
        select: {
          id: true,
          orderCode: true,
          status: true,
          fulfillmentStatus: true,
          customer: {
            select: {
              alias: true,
              firstName: true,
              lastName: true,
            },
          },
          items: {
            select: {
              productId: true,
              qty: true,
              unitKind: true,
              product: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const orderCount = links.filter((l) => !!l.order).length;
  const orderItems = links.flatMap((l) => l.order?.items ?? []);

  const uniqueIds = new Set<number>();
  let totalQty = 0;

  // aggregate by productId for preview
  const agg = new Map<
    number,
    { productId: number; name: string; qty: number }
  >();
  for (const it of orderItems) {
    const pid = Number(it.productId);
    if (!Number.isFinite(pid)) continue;
    const q = Math.max(0, Number(it.qty) || 0);
    if (q <= 0) continue;
    uniqueIds.add(pid);
    totalQty += q;
    const cur = agg.get(pid);
    if (cur) cur.qty += q;
    else
      agg.set(pid, {
        productId: pid,
        name: it.product?.name ?? `#${pid}`,
        qty: q,
      });
  }

  const parentOrdersSummary =
    orderCount > 0
      ? {
          orderCount,
          uniqueItemCount: uniqueIds.size,
          totalQty,
        }
      : null;

  const parentOrderTopItems = Array.from(agg.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);

  const dispatchAvailabilityById: Record<number, DispatchAvailabilityRow> = {};
  const dispatchProducts =
    uniqueIds.size > 0
      ? await db.product.findMany({
          where: { id: { in: Array.from(uniqueIds) } },
          select: {
            id: true,
            allowPackSale: true,
            stock: true,
            packingStock: true,
          },
        })
      : [];
  const dispatchProductById = new Map(dispatchProducts.map((p) => [p.id, p]));
  for (const product of dispatchProducts) {
    dispatchAvailabilityById[product.id] = {
      pack: Number(product.stock ?? 0),
      retail: Number(product.packingStock ?? 0),
      allowPackSale: Boolean(product.allowPackSale),
    };
  }

  const linkedParentOrders: LinkedParentOrderRow[] = [];
  for (const link of links) {
    const order = link.order;
    if (!order) continue;

    const totalQty = (order.items || []).reduce(
      (sum, item) => sum + Math.max(0, Number(item.qty) || 0),
      0
    );
    const customerLabel =
      order.customer?.alias?.trim() ||
      [order.customer?.firstName, order.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null;

    linkedParentOrders.push({
      orderId: order.id,
      orderCode: order.orderCode,
      customerLabel,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      itemCount: order.items.length,
      totalQty,
      items: order.items.map((item) => {
        const dispatchProduct = dispatchProductById.get(item.productId);
        const qty = Math.max(0, Number(item.qty) || 0);
        return {
          productId: item.productId,
          name: item.product?.name ?? `#${item.productId}`,
          qty,
          unitKind: resolveDispatchUnitKind({
            storedKind: item.unitKind,
            qty,
            allowPackSale: Boolean(dispatchProduct?.allowPackSale),
          }),
        };
      }),
    });
  }
  linkedParentOrders.sort((a, b) => a.orderId - b.orderId);

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
      status: run.status,
    },
    riderName,
    vehicleId: run.vehicleId ?? run.vehicle?.id ?? null,
    loadoutSnapshot: loadoutSnapshotAgg,
    riderOptions,
    productOptions,
    kgById,
    stockById,
    dispatchAvailabilityById,
    vehicles,
    categories: categoryRows.map((c) => c.name).filter(Boolean),
    readOnly,
    parentOrdersSummary,
    parentOrderTopItems,
    linkedParentOrders,
  };

  return json(data);
}

type ActionData = { ok: true } | { ok: false; error: string };

const toFulfillmentStatus = (
  value: unknown
): FulfillmentStatus | null => {
  if (typeof value !== "string") return null;
  return (Object.values(FulfillmentStatus) as string[]).includes(value)
    ? (value as FulfillmentStatus)
    : null;
};

function getPreDispatchFulfillmentStatus(): FulfillmentStatus | null {
  // Best-effort fallback across enum variations without breaking compile
  const fsMap = FulfillmentStatus as unknown as Record<string, unknown>;
  return (
    toFulfillmentStatus(fsMap.PLANNED) ??
    toFulfillmentStatus(fsMap.PENDING) ??
    toFulfillmentStatus(fsMap.OPEN) ??
    toFulfillmentStatus(fsMap.READY) ??
    toFulfillmentStatus(fsMap.PREPARED) ??
    toFulfillmentStatus(fsMap.CREATED) ??
    toFulfillmentStatus(fsMap.DRAFT) ??
    // if none exist, we at least clear dispatchedAt; status stays as-is
    null
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);

  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json<ActionData>(
      { ok: false, error: "Invalid run ID" },
      { status: 400 }
    );

  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const releaseOrderId = Number(form.get("releaseOrderId") || NaN);

  const riderName = (String(form.get("riderName") ?? "").trim() || null) as
    | string
    | null;

  const vehicleIdRaw = form.get("vehicleId");
  const vehicleId = vehicleIdRaw ? Number(vehicleIdRaw) : null;

  const loadoutJson = String(form.get("loadoutJson") ?? "") || "[]";

  let loadoutSnapshot: LoadoutSnapshotRow[] = [];

  try {
    const parsed: unknown = JSON.parse(loadoutJson);
    if (Array.isArray(parsed)) {
      loadoutSnapshot = parsed
        .map(parseLoadoutSnapshotRow)
        .filter((row): row is LoadoutSnapshotRow => !!row)
        .map((row) => ({
          ...row,
          qty: Math.max(0, Number(row.qty ?? 0) || 0),
        }));
    }
  } catch {
    // ignore invalid JSON -> treat as no loadout
    loadoutSnapshot = [];
  }

  // drop <= 0 qty rows + aggregate duplicates by productId
  loadoutSnapshot = aggregateLoadoutSnapshot(loadoutSnapshot);

  // Canonicalize names from DB to prevent name/productId drift
  // (Never trust posted `name` for any downstream logic.)
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
      select: { id: true, name: true },
    });
    const nameById = new Map(rows.map((r) => [r.id, r.name]));
    loadoutSnapshot = loadoutSnapshot.map((l) => ({
      ...l,
      name: nameById.get(l.productId!) ?? l.name ?? "",
    }));
  }

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

  // Editable ONLY while PLANNED.
  const isReadOnly = run.status !== "PLANNED";

  if (intent === "cancel") {
    return redirect("/runs");
  }

  if (intent === "release-order") {
    if (run.status !== "PLANNED") {
      return json<ActionData>(
        {
          ok: false,
          error: "Only PLANNED runs can release linked orders back to dispatch.",
        },
        { status: 400 }
      );
    }

    if (!Number.isFinite(releaseOrderId) || releaseOrderId <= 0) {
      return json<ActionData>(
        { ok: false, error: "Select a valid linked order to release." },
        { status: 400 }
      );
    }

    const linkedOrder = await db.deliveryRunOrder.findUnique({
      where: {
        runId_orderId: {
          runId: id,
          orderId: releaseOrderId,
        },
      },
      select: {
        orderId: true,
        order: {
          select: {
            id: true,
            dispatchedAt: true,
          },
        },
      },
    });

    if (!linkedOrder) {
      return json<ActionData>(
        { ok: false, error: "Linked order not found on this run." },
        { status: 404 }
      );
    }

    if (linkedOrder.order?.dispatchedAt) {
      return json<ActionData>(
        {
          ok: false,
          error:
            "This order was already dispatched and can no longer be released here.",
        },
        { status: 400 }
      );
    }

    await db.deliveryRunOrder.delete({
      where: {
        runId_orderId: {
          runId: id,
          orderId: releaseOrderId,
        },
      },
    });

    return redirect(`/runs/${id}/dispatch?releasedOrderId=${releaseOrderId}`);
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

  const productsForKg =
    postedIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: postedIds } },
          select: {
            id: true,
            packingSize: true,
            packingUnit: { select: { name: true } },
            srp: true,
          },
        })
      : [];

  const kgByIdServer = new Map<number, number>();
  for (const p of productsForKg) {
    const size = Number(p.packingSize ?? 0);
    const factor = massUnitToKgFactor(p.packingUnit?.name);
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

      // If pure run (no parent orders) we still allow saving empty,
      // but dispatch will enforce non-zero total load.

      await db.deliveryRun.update({
        where: { id },
        data: {
          riderId: riderEmployeeId,
          vehicleId: vehicleId && vehicleId > 0 ? vehicleId : null,
          loadoutSnapshot: toLoadoutSnapshotJson(loadoutSnapshot),
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
      // For Option A correctness:
      // Revert must restore ALL inventory deducted during dispatch:
      // - PAD (linked orders items)
      // - Extra loadoutSnapshot saved on the run
      const runWithSnapshot = await db.deliveryRun.findUnique({
        where: { id },
        select: {
          id: true,
          loadoutSnapshot: true,
        },
      });
      if (!runWithSnapshot) {
        return json<ActionData>(
          { ok: false, error: "Run not found" },
          { status: 404 }
        );
      }

      const extraSnapshot: Array<{ productId: number | null; qty: number }> =
        Array.isArray(runWithSnapshot.loadoutSnapshot)
          ? runWithSnapshot.loadoutSnapshot
              .map(parseLoadoutSnapshotRow)
              .filter((row): row is LoadoutSnapshotRow => !!row)
              .map((row) => ({
                productId: row.productId,
                qty: Math.max(0, Number(row.qty ?? 0) || 0),
              }))
          : [];

      // Fetch linked orders again (same source of truth as dispatch)
      const links = await db.deliveryRunOrder.findMany({
        where: { runId: id },
        include: {
          order: {
            select: {
              id: true,
              items: {
                select: {
                  productId: true,
                  qty: true,
                  unitPrice: true,
                  unitKind: true,
                },
              },
            },
          },
        },
      });

      const orders = links
        .map((l) => l.order)
        .filter((o): o is NonNullable<(typeof links)[number]["order"]> => !!o);

      // Collect all involved product IDs
      const itemIds = new Set<number>();
      for (const o of orders) {
        for (const it of o.items) itemIds.add(it.productId);
      }
      const extraIds = new Set<number>();
      for (const l of extraSnapshot) {
        if (!l.productId) continue;
        extraIds.add(Number(l.productId));
      }
      const allIds = Array.from(new Set([...itemIds, ...extraIds]));

      const products =
        allIds.length > 0
          ? await db.product.findMany({
              where: { id: { in: allIds } },
              select: {
                id: true,
                allowPackSale: true,
                price: true, // retail
                srp: true, // pack
              },
            })
          : [];

      const byId = new Map(products.map((p) => [p.id, p]));

      const approxEqual = (a: number, b: number, eps = 0.25) =>
        Math.abs(a - b) <= eps;

      // Compute deltas exactly like dispatch did
      const deltas = new Map<number, { pack: number; retail: number }>();
      const errors: Array<{ productId: number; reason: string }> = [];

      // From PAD order items: infer retail vs pack
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

          if (
            p.allowPackSale &&
            baseRetail > 0 &&
            approxEqual(unitPrice, baseRetail)
          ) {
            inferred = "RETAIL";
          } else if (basePack > 0 && approxEqual(unitPrice, basePack)) {
            inferred = "PACK";
          }

          if (!inferred && basePack > 0) inferred = "PACK";

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

      // Extra snapshot: pack-only
      for (const l of extraSnapshot) {
        if (!l.productId) continue;
        const pid = Number(l.productId);
        const q = Number(l.qty || 0);
        if (!Number.isFinite(pid) || pid <= 0 || q <= 0) continue;
        const c = deltas.get(pid) ?? { pack: 0, retail: 0 };
        c.pack += q;
        deltas.set(pid, c);
      }

      if (errors.length) {
        return json<ActionData>(
          { ok: false, error: "Cannot revert (unit inference failed)." },
          { status: 400 }
        );
      }

      await db.$transaction(async (tx) => {
        // 1) Restore inventory (reverse of dispatch decrements)
        for (const [pid, c] of deltas.entries()) {
          await tx.product.update({
            where: { id: pid },
            data: {
              stock: { increment: c.pack }, // PACK restore
              packingStock: { increment: c.retail }, // RETAIL restore
            },
          });
        }

        // ✅ Remove any stale receipt-level cash data if it exists
        // (RunReceiptLine will be removed via onDelete: Cascade from RunReceipt)
        await tx.runReceipt.deleteMany({ where: { runId: id } });

        // ✅ Remove any stale variance records (optional but recommended)
        await tx.riderRunVariance.deleteMany({ where: { runId: id } });

        // 2) Reset linked orders back to pre-dispatch (best-effort)
        const pre = getPreDispatchFulfillmentStatus();
        for (const o of orders) {
          const orderUpdateData: Prisma.OrderUpdateInput = {
            dispatchedAt: null,
          };
          if (pre) {
            orderUpdateData.fulfillmentStatus = pre;
          }
          await tx.order.update({
            where: { id: o.id },
            data: orderUpdateData,
          });
        }

        // ✅ Reset run to PLANNED and clear check-in snapshot fields
        await tx.deliveryRun.update({
          where: { id },
          data: {
            status: "PLANNED",
            dispatchedAt: null,
            riderCheckinSnapshot: Prisma.DbNull,
            riderCheckinAt: null,
            riderCheckinNotes: null,
          },
        });
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
              isOnCredit: true,
              releaseWithBalance: true,
              customer: {
                select: {
                  firstName: true,
                  lastName: true,
                  alias: true,
                  phone: true,
                },
              },
              items: {
                select: {
                  id: true,
                  productId: true,
                  name: true,
                  qty: true,
                  unitPrice: true,
                  lineTotal: true,
                  unitKind: true,
                },
              },
            },
          },
        },
      });

      const orders = links
        .map((l) => l.order)
        .filter((o): o is NonNullable<(typeof links)[number]["order"]> => !!o);
      const orderIds = orders.map((order) => order.id);

      const conflictingActiveRunLinks = await loadActiveDeliveryRunLinksByOrderIds(
        db,
        orderIds,
        { excludeRunId: id },
      );
      if (conflictingActiveRunLinks.size > 0) {
        return json<ActionData>(
          {
            ok: false,
            error:
              "Cannot dispatch because some linked orders are already assigned to another active run.",
          },
          { status: 409 }
        );
      }

      // Dispatch rule:
      // - If there are PAD items, dispatch allowed even with zero EXTRA loadout.
      // - If no PAD, must have at least 1 EXTRA loadout line.
      const padQtyTotal = orders.reduce((sum, o) => {
        return (
          sum +
          (o.items || []).reduce(
            (s, it) => s + Math.max(0, Number(it.qty) || 0),
            0
          )
        );
      }, 0);
      const extraQtyTotal = loadoutSnapshot.reduce(
        (s, l) => s + Math.max(0, Number(l.qty) || 0),
        0
      );
      if (padQtyTotal <= 0 && extraQtyTotal <= 0) {
        return json<ActionData>(
          {
            ok: false,
            error:
              "Cannot dispatch with zero load. Add extra loadout or link parent orders (PAD).",
          },
          { status: 400 }
        );
      }

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

      // 3️⃣ From ORDER ITEMS: infer RETAIL vs PACK per line, then accumulate
      for (const o of orders) {
        for (const it of o.items) {
          const p = byId.get(it.productId);
          if (!p) {
            errors.push({ productId: it.productId, reason: "Product missing" });
            continue;
          }
          const qty = Math.max(0, Number(it.qty) || 0);
          if (qty <= 0) continue;

          // ✅ Prefer stored unitKind ALWAYS.
          // If missing (legacy), do NOT infer by comparing to *live* product prices
          // because product price can change after order creation.
          const inferred = resolveDispatchUnitKind({
            storedKind: it.unitKind,
            qty,
            allowPackSale: Boolean(p.allowPackSale),
          });

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

        // ✅ Create/refresh PARENT run receipts (one per linked PAD order)
        // These are the cashier-facing "parent receipts" for the run.
        for (const o of orders) {
          const receiptKey = `PARENT:${o.id}`; // stable per run + order
          const customerName =
            o.customer?.alias?.trim() ||
            [o.customer?.firstName, o.customer?.lastName]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            null;
          const customerPhone = o.customer?.phone ?? null;

          // IMPORTANT:
          // During DISPATCHED stage, cashCollected is usually 0.
          // Do NOT infer credit from cashCollected.
          // Instead, stamp explicit isCredit in note based on the parent order truth.
          // (Adjust these fields if your Order schema uses different names.)
          const orderRecord = o as Record<string, unknown>;
          const isCreditTruth =
            Boolean(o.isOnCredit) ||
            Boolean(orderRecord.releaseWithBalance) ||
            Boolean(orderRecord.releasedWithBalance);

          const noteMeta = {
            isCredit: isCreditTruth,
            source: "DISPATCH:ORDER_SNAPSHOT",
            orderId: o.id,
          };

          await tx.runReceipt.upsert({
            where: {
              runId_receiptKey: { runId: id, receiptKey },
            },
            update: {
              kind: "PARENT",
              parentOrderId: o.id,
              customerId: o.customerId ?? null,
              customerName,
              customerPhone,
              note: JSON.stringify(noteMeta),
              // never change cashCollected here (cash is later, rider check-in / cashier settle)
            },
            create: {
              runId: id,
              kind: "PARENT",
              receiptKey,
              parentOrderId: o.id,
              customerId: o.customerId ?? null,
              customerName,
              customerPhone,
              cashCollected: new Prisma.Decimal(0),
              note: JSON.stringify(noteMeta),
              status: "DRAFT",
            },
            select: { id: true },
          });

          // NOTE:
          // Do NOT snapshot receipt lines during dispatch.
          // Frozen pricing happens at Manager CHECK-IN.
          // Snapshot/refresh receipt lines must run AFTER freeze to avoid "50 vs 48" drift.
          // NOTE: No receipt lines snapshot here (freeze happens at Manager CHECK-IN).
        }

        // run
        await tx.deliveryRun.update({
          where: { id },
          data: {
            status: "DISPATCHED",
            dispatchedAt: now,
            riderId: riderEmployeeId,
            vehicleId: vehicleId && vehicleId > 0 ? vehicleId : null,
            loadoutSnapshot: toLoadoutSnapshotJson(loadoutSnapshot), // EXTRA-only snapshot (PAD inferred from linked orders)
            // ✅ ensure fresh check-in state for this dispatch
            riderCheckinSnapshot: Prisma.DbNull,
            riderCheckinAt: null,
            riderCheckinNotes: null,
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
      // 7️⃣ Redirect: dispatch is logistics; cashier handles receipts
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
    dispatchAvailabilityById,
    vehicles,
    readOnly,
    parentOrdersSummary,
    parentOrderTopItems,
    linkedParentOrders,
  } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const [sp] = useSearchParams();
  const savedFlag = sp.get("saved") === "1";
  const releasedOrderId = Number(sp.get("releasedOrderId") || NaN);
  const busy = nav.state !== "idle";
  const pendingIntent = String(nav.formData?.get("intent") ?? "");
  const pendingReleaseOrderId = Number(nav.formData?.get("releaseOrderId") || NaN);
  const releaseBusy = pendingIntent === "release-order" && busy;
  const saveBusy = pendingIntent === "save" && busy;
  const saveExitBusy = pendingIntent === "save-exit" && busy;
  const dispatchBusy = pendingIntent === "dispatch" && busy;
  const cancelBusy = pendingIntent === "cancel" && busy;
  const revertBusy = pendingIntent === "revert-planned" && busy;
  const actionBusy = saveBusy || saveExitBusy || dispatchBusy || cancelBusy || revertBusy;

  const [riderName, setRiderName] = React.useState<string>(
    riderFromServer ?? ""
  );
  const [vehicleId, setVehicleId] = React.useState<number | null>(
    vehicleIdFromServer
  );
  const selectedVehicleName =
    vehicleId != null
      ? vehicles.find((vehicle) => vehicle.id === vehicleId)?.name ?? "—"
      : "Not set";

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

  // Aggregate current UI state by productId (prevents duplicate display + bad submits)
  const aggregatedLoadout = React.useMemo(() => {
    const map = new Map<number, LoadLine>();
    for (const L of loadout) {
      const pid = L.productId;
      const q = qtyNum(L.qty);
      if (!pid || !Number.isFinite(pid) || q <= 0) continue;
      const cur = map.get(pid);
      if (cur) {
        const newQty = qtyNum(cur.qty) + q;
        map.set(pid, { ...cur, qty: String(Math.round(newQty)) });
      } else {
        map.set(pid, { ...L, qty: String(Math.round(q)) });
      }
    }
    return Array.from(map.values());
  }, [loadout]);

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

  const dispatchAvailabilityMap = React.useMemo(
    () =>
      new Map<number, DispatchAvailabilityRow>(
        Object.entries(dispatchAvailabilityById).map(([k, v]) => [
          Number(k),
          {
            pack: Number(v.pack ?? 0),
            retail: Number(v.retail ?? 0),
            allowPackSale: Boolean(v.allowPackSale),
          },
        ])
      ),
    [dispatchAvailabilityById]
  );

  const usedCapacityKg = React.useMemo(() => {
    return aggregatedLoadout.reduce((sum, L) => {
      if (!L.productId) return sum;
      const kg = kgMap.get(L.productId) ?? 0;
      return sum + kg * qtyNum(L.qty);
    }, 0);
  }, [aggregatedLoadout, kgMap]);

  const capacityKg = React.useMemo(() => {
    if (vehicleId == null) return null;
    return vehicles.find((v) => v.id === vehicleId)?.capacityKg ?? null;
  }, [vehicleId, vehicles]);

  const overCapacity =
    capacityKg != null && usedCapacityKg > capacityKg && capacityKg > 0;

  const serializedLoadout = React.useMemo(() => {
    // Always submit aggregated payload (no dupes)
    const clean = aggregatedLoadout.map((L) => ({
      productId: Number(L.productId),
      name: L.name,
      qty: qtyNum(L.qty),
    }));
    return JSON.stringify(clean);
  }, [aggregatedLoadout]);

  const disableAll = busy || readOnly;
  const hasRider = riderName.trim().length > 0;

  const totalLoadUnits = React.useMemo(
    () =>
      aggregatedLoadout.reduce((s, L) => {
        if (!L.productId) return s;
        return s + qtyNum(L.qty);
      }, 0),
    [aggregatedLoadout]
  );
  const padQtyTotal = React.useMemo(() => {
    const q = parentOrdersSummary?.totalQty ?? 0;
    return Number.isFinite(q) ? q : 0;
  }, [parentOrdersSummary]);

  const canDispatchByQty = padQtyTotal > 0 || totalLoadUnits > 0;

  const overStock = React.useMemo(() => {
    return aggregatedLoadout.some((L) => {
      if (!L.productId) return false;
      const pid = Number(L.productId);
      const q = qtyNum(L.qty);
      const stock = stockMap.get(pid) || 0;
      return q > stock;
    });
  }, [aggregatedLoadout, stockMap]);

  const runDraftShortageByKey = React.useMemo(() => {
    const demandByKey = new Map<string, number>();

    for (const order of linkedParentOrders) {
      for (const item of order.items) {
        const demandKey = makeDispatchDemandKey(item.productId, item.unitKind);
        demandByKey.set(demandKey, (demandByKey.get(demandKey) ?? 0) + item.qty);
      }
    }

    for (const row of aggregatedLoadout) {
      if (!row.productId) continue;
      const demandKey = makeDispatchDemandKey(row.productId, "PACK");
      demandByKey.set(
        demandKey,
        (demandByKey.get(demandKey) ?? 0) + qtyNum(row.qty)
      );
    }

    const shortages = new Map<
      string,
      {
        unitKind: DispatchUnitKind;
        available: number;
        required: number;
        shortage: number;
      }
    >();

    for (const [demandKey, required] of demandByKey.entries()) {
      const [productIdRaw, unitKindRaw] = demandKey.split(":");
      const productId = Number(productIdRaw);
      const unitKind = unitKindRaw === "RETAIL" ? "RETAIL" : "PACK";
      const availability = dispatchAvailabilityMap.get(productId);
      const available =
        unitKind === "RETAIL"
          ? Number(availability?.retail ?? 0)
          : Number(availability?.pack ?? 0);

      if (required > available) {
        shortages.set(demandKey, {
          unitKind,
          available,
          required,
          shortage: required - available,
        });
      }
    }

    return shortages;
  }, [aggregatedLoadout, dispatchAvailabilityMap, linkedParentOrders]);

  const hasRunDraftShortage = runDraftShortageByKey.size > 0;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Dispatch Staging"
        subtitle={`Run ${run.runCode} · ${
          readOnly
            ? "Dispatched already. Staging is read-only."
            : "Assign rider, vehicle, and extra loadout before dispatch."
        }`}
        backTo="/runs"
        backLabel="Runs"
      />

      <div className="mx-auto max-w-6xl space-y-3 px-5 py-6">
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Status{" "}
            <span className="font-semibold text-slate-900">{run.status}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Rider{" "}
            <span className="font-semibold text-slate-900">
              {riderName || "Not set"}
            </span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Vehicle{" "}
            <span className="font-semibold text-slate-900">
              {selectedVehicleName}
            </span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Linked orders{" "}
            <span className="font-semibold text-slate-900">
              {parentOrdersSummary?.orderCount ?? 0}
            </span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Extra loadout{" "}
            <span className="font-semibold text-slate-900">{totalLoadUnits}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Capacity{" "}
            <span className="font-semibold text-slate-900">
              {Math.round(usedCapacityKg)}
              {capacityKg != null ? ` / ${capacityKg} kg` : " kg"}
            </span>
          </span>
        </div>

        {/* Parent orders clarity box */}
        {parentOrdersSummary && (
          <SoTCard>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-800">
                Linked Orders
              </div>
              <div className="text-xs text-slate-600">
                {parentOrdersSummary.orderCount} order(s) ·{" "}
                {parentOrdersSummary.uniqueItemCount} item(s) ·{" "}
                {parentOrdersSummary.totalQty} total qty
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              Linked order items are part of dispatch stock deductions. `Loadout`
              below is only for extra physical load you add on top.
            </div>
            {parentOrderTopItems.length > 0 && (
              <div className="mt-2 grid gap-1">
                {parentOrderTopItems.map((it) => (
                  <div key={it.productId} className="text-xs text-slate-700">
                    <span className="font-mono text-slate-500">
                      #{it.productId}
                    </span>{" "}
                    {it.name} — <span className="font-semibold">{it.qty}</span>
                  </div>
                ))}
              </div>
            )}
            {!readOnly && hasRunDraftShortage ? (
              <SoTAlert tone="warning" className="mt-3 text-sm">
                Current run draft exceeds live stock on one or more linked item
                rows. Release the affected order or rebalance the loadout before
                dispatch.
              </SoTAlert>
            ) : null}
            {linkedParentOrders.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                {linkedParentOrders.map((order) => {
                  const orderHasShortage = order.items.some((item) =>
                    runDraftShortageByKey.has(
                      makeDispatchDemandKey(item.productId, item.unitKind)
                    )
                  );

                  return (
                    <div
                      key={order.orderId}
                      className={`rounded-xl border px-3 py-3 ${
                        orderHasShortage
                          ? "border-rose-200 bg-rose-50/70"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-slate-800">
                              {order.orderCode}
                            </div>
                            {orderHasShortage ? (
                              <SoTStatusBadge tone="danger">
                                Contains insufficient item
                              </SoTStatusBadge>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {order.customerLabel ?? "Walk-in / unnamed delivery"}{" "}
                            · {order.itemCount} item(s) · {order.totalQty} total
                            qty
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Order {order.status} · Fulfillment{" "}
                            {order.fulfillmentStatus ?? "—"}
                          </div>
                        </div>

                        {!readOnly ? (
                          <Form method="post" replace className="shrink-0 space-y-2">
                            <input
                              type="hidden"
                              name="releaseOrderId"
                              value={order.orderId}
                            />
                            {releaseBusy && pendingReleaseOrderId === order.orderId ? (
                              <SoTLoadingState
                                variant="inline"
                                label="Releasing linked order"
                                hint="Returning this order to the queue."
                              />
                            ) : null}
                            <SoTButton
                              name="intent"
                              value="release-order"
                              type="submit"
                              variant="secondary"
                              disabled={busy}
                              className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            >
                              {releaseBusy && pendingReleaseOrderId === order.orderId
                                ? "Releasing…"
                                : "Release Order"}
                            </SoTButton>
                          </Form>
                        ) : null}
                      </div>

                      <div className="mt-3 grid gap-2">
                        {order.items.map((item) => {
                          const shortage = runDraftShortageByKey.get(
                            makeDispatchDemandKey(item.productId, item.unitKind)
                          );

                          return (
                            <div
                              key={`${order.orderId}-${item.productId}-${item.unitKind}`}
                              className={`rounded-lg border px-3 py-2 ${
                                shortage
                                  ? "border-rose-200 bg-white"
                                  : "border-slate-200 bg-white/80"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-slate-800">
                                  #{item.productId} {item.name}
                                </span>
                                <SoTStatusBadge tone="neutral">
                                  {item.unitKind}
                                </SoTStatusBadge>
                                {shortage ? (
                                  <SoTStatusBadge tone="danger">
                                    Insufficient stock
                                  </SoTStatusBadge>
                                ) : null}
                              </div>
                              <div
                                className={`mt-1 text-[11px] ${
                                  shortage ? "text-rose-700" : "text-slate-500"
                                }`}
                              >
                                Qty: {item.qty}
                                {shortage
                                  ? ` · Needs ${shortage.required} ${shortage.unitKind.toLowerCase()}, only ${shortage.available} available (short ${shortage.shortage}).`
                                  : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SoTCard>
        )}

        {savedFlag ? (
          <SoTAlert tone="success" className="mb-3 text-sm">
            Staging saved.
          </SoTAlert>
        ) : null}

        {Number.isFinite(releasedOrderId) && releasedOrderId > 0 ? (
          <SoTAlert tone="success" className="mb-3 text-sm">
            Linked order #{releasedOrderId} was released back to the dispatch
            queue.
          </SoTAlert>
        ) : null}

        {actionData && !actionData.ok ? (
          <SoTAlert tone="danger" className="mb-3 text-sm">
            {actionData.error}
          </SoTAlert>
        ) : null}

        <div className="grid gap-4">
          {/* Rider */}
          <SoTCard>
            <div className="mb-2 flex items-center justify-between">
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
          </SoTCard>

          {/* Vehicle + capacity */}
          <SoTCard>
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
          </SoTCard>

          {/* Loadout */}
          <SoTCard className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-medium text-slate-800">
                Extra Loadout
              </div>
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
            <div className="space-y-3 px-4 py-4">
              <div className="text-xs text-slate-600">
                Add only the extra manual load for this run. Linked order items are
                already counted above.
              </div>
              {overCapacity ? (
                <SoTAlert tone="danger">
                  Capacity exceeded (kg). Adjust loadout or choose a different
                  vehicle.
                </SoTAlert>
              ) : null}
              {overStock ? (
                <SoTAlert tone="warning">
                  One or more lines exceed available stock.
                </SoTAlert>
              ) : null}

              {!readOnly && (
                <SoTButton
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
                  variant="secondary"
                  disabled={disableAll}
                >
                  + Add row
                </SoTButton>
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
                              // 💡 Huwag ipakita ang products na wala sa `stockMap`
                              // (ibig sabihin: 0 or invalid stock for this run)
                              filterRow={(p) => {
                                const stock = stockMap.get(p.id) ?? 0;
                                return stock > 0;
                              }}
                              onSelect={(p) => {
                                // Merge duplicates: if product already exists in another row,
                                // add qty there then remove this row.
                                setLoadout((prev) => {
                                  const current = prev.find(
                                    (x) => x.key === L.key
                                  );
                                  const currentQty = current
                                    ? qtyNum(current.qty)
                                    : 0;
                                  const existing = prev.find(
                                    (x) =>
                                      x.key !== L.key && x.productId === p.id
                                  );
                                  if (existing) {
                                    const mergedQty = Math.round(
                                      qtyNum(existing.qty) +
                                        (currentQty > 0 ? currentQty : 1)
                                    );
                                    return prev
                                      .filter((x) => x.key !== L.key)
                                      .map((x) =>
                                        x.key === existing.key
                                          ? {
                                              ...x,
                                              productId: p.id,
                                              name: p.name,
                                              qty: String(mergedQty),
                                            }
                                          : x
                                      );
                                  }
                                  return prev.map((x) =>
                                    x.key === L.key
                                      ? {
                                          ...x,
                                          productId: p.id,
                                          name: p.name,
                                          qty:
                                            x.qty && qtyNum(x.qty) > 0
                                              ? x.qty
                                              : "1",
                                        }
                                      : x
                                  );
                                });
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
                              className="h-10 w-full max-w-[7rem] rounded-xl border border-slate-200 bg-white px-3 text-sm text-right outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
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
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
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
          </SoTCard>

          {/* Actions */}
          <Form
            method="post"
            replace
            className="mt-3"
          >
            <input type="hidden" name="riderName" value={riderName} />
            <input type="hidden" name="vehicleId" value={vehicleId ?? ""} />
            <input type="hidden" name="loadoutJson" value={serializedLoadout} />

            {actionBusy ? (
              <SoTLoadingState
                variant="panel"
                className="mb-3"
                label={
                  dispatchBusy
                    ? "Dispatching run"
                    : saveExitBusy
                      ? "Saving and leaving staging"
                      : saveBusy
                        ? "Saving staging"
                        : cancelBusy
                          ? "Cancelling run"
                          : "Reverting run to planned"
                }
                hint={
                  dispatchBusy
                    ? "Locking the loadout and moving the run to dispatch."
                    : saveExitBusy
                      ? "Saving the current staging details before returning."
                      : saveBusy
                        ? "Keeping the current staging details on this page."
                        : cancelBusy
                          ? "Closing this staging flow and returning to the run list."
                        : "Unlocking the run so it can be staged again."
                }
              />
            ) : null}

            <div className="mb-3 text-xs text-slate-600">
              {readOnly
                ? "This run is already dispatched. Revert only if staging needs to be reopened."
                : "Next step: save staging or dispatch once rider, stock, and capacity are ready."}
            </div>

            <fieldset
              disabled={busy}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end disabled:cursor-not-allowed disabled:opacity-70"
            >
              <SoTButton
                name="intent"
                value="cancel"
                variant="secondary"
                type="submit"
              >
                {cancelBusy ? "Closing…" : "Back to Runs"}
              </SoTButton>

              {!readOnly ? (
                <>
                  <SoTButton
                    name="intent"
                    value="save"
                    type="submit"
                    variant="secondary"
                    className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  >
                    {saveBusy ? "Saving…" : "Save Staging"}
                  </SoTButton>
                  <SoTButton
                    name="intent"
                    value="save-exit"
                    type="submit"
                    variant="secondary"
                  >
                    {saveExitBusy ? "Saving…" : "Save and Exit"}
                  </SoTButton>
                  <SoTButton
                    name="intent"
                    value="dispatch"
                    type="submit"
                    disabled={
                      busy ||
                      !hasRider ||
                      overCapacity ||
                      overStock ||
                      hasRunDraftShortage ||
                      !canDispatchByQty
                    }
                    title={
                      !hasRider
                        ? "Choose a driver first"
                        : overCapacity
                        ? "Capacity exceeded (kg)"
                        : overStock
                        ? "One or more lines exceed available stock"
                        : hasRunDraftShortage
                        ? "Linked order items exceed available stock for the current run draft"
                        : !canDispatchByQty
                        ? "Add extra loadout or link parent orders (PAD)"
                        : "Ready to dispatch"
                    }
                    variant="primary"
                    className="disabled:cursor-not-allowed"
                  >
                    {dispatchBusy ? "Dispatching…" : "Dispatch Run"}
                  </SoTButton>
                </>
              ) : (
                <SoTButton
                  name="intent"
                  value="revert-planned"
                  type="submit"
                  variant="secondary"
                  className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                >
                  {revertBusy ? "Reverting…" : "Reopen Staging"}
                </SoTButton>
              )}
            </fieldset>
          </Form>
        </div>
      </div>
    </main>
  );
}
