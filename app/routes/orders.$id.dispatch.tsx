// app/routes/orders.$id.dispatch.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { FulfillmentStatus, UnitKind } from "@prisma/client";
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
import { computeUnitPriceForCustomer } from "~/services/pricing";
import { SelectInput } from "~/components/ui/SelectInput";
import { ProductPickerHybridLoadout } from "~/components/ui/ProductPickerHybridLoadout";

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
    srp: number;
    allowDecimal: boolean; // based on product.unit (retail supports decimal in your system)
  }>;
  order: {
    id: number;
    orderCode: string;
    fulfillmentStatus: FulfillmentStatus | null;
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
  categories?: string[];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    select: {
      channel: true,
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

  // ensure this page is only for DELIVERY orders
  if (!order) throw new Response("Not found", { status: 404 });
  if (order.channel !== "DELIVERY") {
    return redirect(`/cashier?tab=dispatch`);
  }
  // Lightweight product catalog for loadout picker — PACK / whole items (any category)
  // Accept any active product that has a PACK price (srp > 0). This excludes pure retail-only SKUs.
  const packProducts = await db.product.findMany({
    where: {
      isActive: true,
      srp: { gt: 0 }, // has a pack/whole price
      stock: { gt: 0 }, // has pack stock available
    },
    select: { id: true, name: true, stock: true, srp: true },
    orderBy: { name: "asc" },
    take: 500,
  });

  // Loadout counts whole units only
  const productOptions = packProducts.map((p) => ({
    id: p.id,
    name: p.name,
    srp: Number(p.srp ?? 0),
    allowDecimal: false,
  }));

  // Build rider options: STRICT from Employees with role=RIDER only
  const employees = await db.employee.findMany({
    where: { role: "RIDER", active: true },
    select: { alias: true, firstName: true, lastName: true },
    orderBy: [{ alias: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
    take: 100,
  });
  const riderOptions = employees
    .map((e) =>
      (
        e.alias?.trim() || [e.firstName, e.lastName].filter(Boolean).join(" ")
      ).trim()
    )
    .filter(Boolean);

  // (order is guaranteed by the guard above)

  const customerName = order.customer
    ? order.customer.alias ??
      [order.customer.firstName, order.customer.lastName]
        .filter(Boolean)
        .join(" ")
    : null;

  // Preload all categories na may at least 1 active, pack-eligible product (optional guard)
  const categories = await db.category.findMany({
    where: {
      products: {
        some: {
          isActive: true,
          srp: { gt: 0 }, // pack items lang kung gusto mong match sa loadout
        },
      },
    },
    select: { name: true },
    orderBy: { name: "asc" },
  });

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
    categories: categories.map((c) => c.name).filter(Boolean),
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
  const riderName = (String(form.get("riderName") ?? "").trim() || null) as
    | string
    | null;

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

  // 🔧 Drop all lines with qty <= 0 (hindi na sasama sa validations/dispatch)
  loadoutSnapshot = loadoutSnapshot.filter((l) => Number(l.qty) > 0);

  // ❗ Guard: any line with qty > 0 must have a valid productId
  const incompleteLoadLines = loadoutSnapshot.filter(
    (l) =>
      Number(l.qty) > 0 &&
      (l.productId == null || !Number.isFinite(Number(l.productId)))
  );
  if (incompleteLoadLines.length > 0) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "Loadout has items with quantity but no product selected. Please pick a product for each line.",
      },
      { status: 400 }
    );
  }

  // (optional) If there are positive-qty loadout lines, require at least one valid productId
  const hasQtyLines = loadoutSnapshot.some((l) => Number(l.qty) > 0);

  // Load current status to enforce read-only behavior after dispatch
  const order = await db.order.findUnique({
    where: { id },
    select: { fulfillmentStatus: true, riderName: true, channel: true },
  });
  if (!order)
    return json<ActionData>(
      { ok: false, error: "Order not found" },
      { status: 404 }
    );

  // Extra guard: action must only operate on DELIVERY orders
  if (order.channel !== "DELIVERY") {
    return json<ActionData>(
      { ok: false, error: "Not a DELIVERY order." },
      { status: 400 }
    );
  }

  const isReadOnly = order.fulfillmentStatus === "DISPATCHED";

  // 🔒 Strict server-side validation: rider must be an active RIDER employee
  const employeeRiders = await db.employee.findMany({
    where: { role: "RIDER", active: true },
    select: { alias: true, firstName: true, lastName: true },
    take: 200,
  });
  const validRiderSet = new Set(
    employeeRiders
      .map((e) =>
        (
          e.alias?.trim() || [e.firstName, e.lastName].filter(Boolean).join(" ")
        ).trim()
      )
      .filter(Boolean)
  );
  if (!riderName || !validRiderSet.has(riderName)) {
    return json<ActionData>(
      { ok: false, error: "Rider must be selected from the list." },
      { status: 400 }
    );
  }

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

  // 🔒 Server-side guard: loadout must reference PACK/whole items (must have srp > 0).
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
      select: { id: true, srp: true },
    });
    const invalid = rows
      .filter((r) => Number(r.srp ?? 0) <= 0)
      .map((r) => r.id);
    if (invalid.length > 0) {
      return json<ActionData>(
        {
          ok: false,
          error:
            "Loadout can only include whole/pack items (with a pack price).",
        },
        { status: 400 }
      );
    }
  } else if (hasQtyLines) {
    // May qty>0 pero walang nabalidate na productId — huwag ituloy
    return json<ActionData>(
      {
        ok: false,
        error: "Loadout quantity present but no valid products selected.",
      },
      { status: 400 }
    );
  }

  switch (intent) {
    case "cancel":
      return redirect(`/cashier?tab=dispatch`);

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
          riderName: riderName ?? order.riderName ?? null,
          vehicleName,
          loadoutSnapshot: loadoutSnapshot as any,
          fulfillmentStatus: FulfillmentStatus.STAGED,
          stagedAt: new Date(),
        },
      });
      return redirect(`/cashier?tab=dispatch`);

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
          riderName: riderName ?? order.riderName ?? null,
          vehicleName,
          loadoutSnapshot: loadoutSnapshot as any,
          fulfillmentStatus: FulfillmentStatus.STAGED,
          stagedAt: new Date(),
        },
      });
      return redirect(`/orders/${id}/dispatch?saved=1`);
    case "dispatch": {
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
      // Inventory side-effects:
      // 1) Deduct ORDER ITEMS (infer RETAIL vs PACK)
      // 2) Deduct LOADOUT (PACK only; extra cylinders leaving the store)
      const fullOrder = await db.order.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!fullOrder) {
        return json<ActionData>(
          { ok: false, error: "Order not found" },
          { status: 404 }
        );
      }
      // IDs used in ORDER items…
      const itemIds = Array.from(
        new Set(fullOrder.items.map((i) => i.productId))
      );
      // …and IDs used in LOADOUT snapshot (from parsed form earlier)
      const loadoutIds = Array.from(
        new Set(
          loadoutSnapshot
            .map((l) => (l?.productId == null ? null : Number(l.productId)))
            .filter((v): v is number => Number.isFinite(v))
        )
      );
      // Fetch for the UNION so stock checks “see” both sources
      const allIds = Array.from(new Set([...itemIds, ...loadoutIds]));
      const products = await db.product.findMany({
        where: { id: { in: allIds } },
        select: {
          id: true,
          allowPackSale: true,
          price: true,
          srp: true,
          stock: true,
          packingStock: true,
        },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      const errors: Array<{ id: number; reason: string }> = [];
      // Combined decrements we will apply at dispatch:
      //   pack   → product.stock
      //   retail → product.packingStock
      const deltas = new Map<number, { pack: number; retail: number }>();

      const customerIdForAllowed = fullOrder.customerId ?? null;

      // --- (1) accumulate ORDER ITEMS by inferring unit kind ---
      for (const it of fullOrder.items) {
        const p = byId.get(it.productId);
        if (!p) {
          errors.push({ id: it.productId, reason: "Product missing" });
          continue;
        }
        const unitPrice = Number(it.unitPrice);
        const qty = Number(it.qty);
        const baseRetail = Number(p.price ?? 0);
        const basePack = Number(p.srp ?? 0);

        const [allowedRetail, allowedPack] = await Promise.all([
          baseRetail > 0
            ? computeUnitPriceForCustomer(db as any, {
                customerId: customerIdForAllowed,
                productId: p.id,
                unitKind: UnitKind.RETAIL,
                baseUnitPrice: baseRetail,
              })
            : Promise.resolve(NaN),
          basePack > 0
            ? computeUnitPriceForCustomer(db as any, {
                customerId: customerIdForAllowed,
                productId: p.id,
                unitKind: UnitKind.PACK,
                baseUnitPrice: basePack,
              })
            : Promise.resolve(NaN),
        ]);
        let inferred: UnitKind | null = null;
        if (Number.isFinite(allowedRetail) || Number.isFinite(allowedPack)) {
          const dRetail = Number.isFinite(allowedRetail)
            ? Math.abs(unitPrice - Number(allowedRetail))
            : Number.POSITIVE_INFINITY;
          const dPack = Number.isFinite(allowedPack)
            ? Math.abs(unitPrice - Number(allowedPack))
            : Number.POSITIVE_INFINITY;
          if (Math.min(dRetail, dPack) !== Number.POSITIVE_INFINITY) {
            inferred =
              dRetail <= dPack && !!p.allowPackSale
                ? UnitKind.RETAIL
                : UnitKind.PACK;
          }
        }
        if (!inferred) {
          const approxEqual = (a: number, b: number, eps = 0.25) =>
            Math.abs(a - b) <= eps;
          if (
            p.allowPackSale &&
            baseRetail > 0 &&
            approxEqual(unitPrice, baseRetail)
          )
            inferred = UnitKind.RETAIL;
          else if (basePack > 0 && approxEqual(unitPrice, basePack))
            inferred = UnitKind.PACK;
        }
        if (!inferred) {
          errors.push({ id: it.productId, reason: "Cannot infer unit kind" });
          continue;
        }
        // NOTE: we do NOT validate stock here; first we combine with loadout,
        // then validate once against current inventory.
        const c = deltas.get(p.id) ?? { pack: 0, retail: 0 };
        if (inferred === UnitKind.RETAIL) c.retail += qty;
        else c.pack += qty;
        deltas.set(p.id, c);
      }
      if (errors.length) {
        return json<ActionData>(
          { ok: false, error: "Stock check failed." },
          { status: 400 }
        );
      }

      // --- (2) add LOADOUT (PACK only) to combined deltas ---
      // Aggregate snapshot rows by productId (coerce to integers for LPG)
      const loadPack = new Map<number, number>();
      for (const l of loadoutSnapshot) {
        if (!l?.productId) continue;
        const pid = Number(l.productId);
        const q = Math.max(0, Math.floor(Number(l.qty ?? 0)));
        if (q <= 0) continue;
        loadPack.set(pid, (loadPack.get(pid) || 0) + q);
      }
      // merge loadout PACK into deltas
      for (const [pid, q] of loadPack.entries()) {
        const c = deltas.get(pid) ?? { pack: 0, retail: 0 };
        c.pack += q;
        deltas.set(pid, c);
      }
      if (errors.length) {
        return json<ActionData>(
          { ok: false, error: "Stock check failed." },
          { status: 400 }
        );
      }

      // --- unified validation: ensure current stock can cover combined deltas ---
      for (const [pid, c] of deltas.entries()) {
        const p = products.find((x) => x.id === pid)!;
        const packStock = Number(p.stock ?? 0);
        const retailStock = Number(p.packingStock ?? 0);
        if (c.pack > packStock) {
          errors.push({
            id: pid,
            reason: `Not enough PACK stock (have ${packStock}, need ${c.pack})`,
          });
        }
        if (c.retail > retailStock) {
          errors.push({
            id: pid,
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

      await db.$transaction(async (tx) => {
        // Decrement based on combined deltas (order items + loadout)
        for (const [pid, c] of deltas.entries()) {
          await tx.product.update({
            where: { id: pid },
            data: {
              stock: { decrement: c.pack }, // PACK
              packingStock: { decrement: c.retail }, // RETAIL
            },
          });
        }
        // Mark dispatched & persist snapshots (rider/vehicle/loadout for ticketing)
        await tx.order.update({
          where: { id },
          data: {
            riderName: riderName ?? order.riderName ?? null,
            vehicleName,
            loadoutSnapshot: loadoutSnapshot as any,
            fulfillmentStatus: FulfillmentStatus.DISPATCHED,
            dispatchedAt: new Date(),
          },
        });
      });

      // 3) Go to ticket (auto-print + back)
      return redirect(`/orders/${id}/ticket?autoprint=1&autoback=1`);
    }
    case "reprint":
      if (!isReadOnly) {
        return json<ActionData>(
          { ok: false, error: "Not dispatched yet." },
          { status: 400 }
        );
      }
      // jump straight to ticket with autoprint
      return redirect(`/orders/${id}/ticket?autoprint=1&autoback=1`);

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
    categories,
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

  const vehicleOptions = React.useMemo(
    () => [
      { value: "", label: "— Select vehicle —" },
      ...Object.keys(VEHICLE_CAPACITY).map((v) => ({ value: v, label: v })),
    ],
    []
  );

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
  const hasUnboundLoad = React.useMemo(
    () => loadout.some((L) => Number(L.qty) > 0 && !L.productId),
    [loadout]
  );

  // SRP preview of current loadout
  const srpById = React.useMemo(
    () => new Map(productOptions.map((p) => [p.id, Number(p.srp ?? 0)])),
    [productOptions]
  );
  const loadoutValue = React.useMemo(
    () =>
      loadout.reduce((s, L) => {
        if (!L.productId) return s;
        const srp = srpById.get(L.productId) ?? 0;
        const qty = Number(L.qty || 0);
        return s + srp * qty;
      }, 0),
    [loadout, srpById]
  );

  // PACK-only whitelist (ids provided by loader)
  const packOnlyIdSet = React.useMemo(
    () => new Set(productOptions.map((p) => p.id)),
    [productOptions]
  );

  // Quick-add chips pulled from your productOptions (e.g., LPG 11kg/22kg)
  const topQuickAdds = React.useMemo(() => {
    const wanted = ["11", "22"]; // add more sizes/keywords if you want
    const picks: { label: string; id: number; allowDecimal: boolean }[] = [];

    for (const kg of wanted) {
      const m = productOptions.find(
        (p) =>
          /lpg/i.test(p.name) &&
          new RegExp(`\\b${kg}\\s?kg\\b`, "i").test(p.name)
      );
      if (m)
        picks.push({
          label: `LPG ${kg}kg`,
          id: m.id,
          allowDecimal: m.allowDecimal,
        });
    }
    return picks;
  }, [productOptions]);

  // ⬇️ place this inside DispatchStagingPage, with other useMemos
  const serializedLoadout = React.useMemo(() => {
    const clean = loadout
      // only keep rows with qty > 0 and a valid productId
      .filter((L) => Number(L.qty) > 0 && Number.isFinite(Number(L.productId)))
      .map((L) => ({
        productId: Number(L.productId),
        name: L.name,
        qty: Number(L.qty),
        allowDecimal: Boolean(L.allowDecimal),
      }));

    return JSON.stringify(clean);
  }, [loadout]);

  const nudgeQty = React.useCallback(
    (rowKey: string, sign: 1 | -1) => {
      setLoadout((prev) =>
        prev.map((l) => {
          if (l.key !== rowKey) return l;
          const step = l.allowDecimal ? 0.01 : 1;
          const next = Math.max(0, (Number(l.qty) || 0) + sign * step);
          const fixed = l.allowDecimal
            ? Number(next.toFixed(2))
            : Math.round(next);
          return { ...l, qty: fixed };
        })
      );
    },
    [setLoadout]
  );

  return (
    <div className="mx-auto p-3 md:p-6 min-h-screen bg-[#f7f7fb]">
      <div className="mb-3">
        <Link
          to={"/cashier?tab=dispatch"}
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
                <SelectInput
                  options={riderOptions.map((r) => ({ value: r, label: r }))}
                  value={riderName}
                  onChange={(val) => setRiderName(String(val))}
                  className={disableAll ? "opacity-70 pointer-events-none" : ""}
                />
                {/* mirror so the form actually posts the value */}
                <input
                  type="hidden"
                  name="riderName"
                  value={riderName}
                  form="dispatch-form"
                />
                <p className="text-[11px] text-slate-500">
                  Pick from active riders.
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
                    ? `Capacity: Max load ${capacity}`
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
                  <SelectInput
                    options={vehicleOptions}
                    value={vehicleName}
                    onChange={(val) => setVehicleName(String(val))}
                    className={
                      disableAll ? "opacity-70 pointer-events-none" : ""
                    }
                  />
                </div>
                {/* hidden fields for POST */}
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

          {/* Loadout (PACK/whole only) */}
          <div className="rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <div className="text-sm font-medium text-slate-800">Loadout</div>
              <div className="min-w-[180px]">
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
                <div className="mt-1 h-2 w-40 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-2 ${
                      overCapacity ? "bg-rose-500" : "bg-indigo-500"
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        capacity ? (usedCapacity / capacity) * 100 : 0
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {hasUnboundLoad && !readOnly && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Some loadout rows have quantity but no product selected.
                  Please pick a product for each line.
                </div>
              )}
              {/* Quick-add shortcuts */}
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  {topQuickAdds.map((qa) => (
                    <button
                      key={qa.id}
                      type="button"
                      disabled={disableAll}
                      onClick={() => {
                        setLoadout((prev) => {
                          const existing = prev.find(
                            (l) => l.productId === qa.id
                          );
                          if (existing) {
                            return prev.map((l) =>
                              l.productId === qa.id
                                ? { ...l, qty: Number(l.qty) + 1 }
                                : l
                            );
                          }
                          const p = productOptions.find((p) => p.id === qa.id)!;
                          return [
                            ...prev,
                            {
                              key: crypto.randomUUID(),
                              productId: qa.id,
                              name: p.name,
                              qty: 1,
                              allowDecimal: qa.allowDecimal,
                            },
                          ];
                        });
                      }}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      + {qa.label}
                    </button>
                  ))}
                  {/* Fallback manual add */}
                  <button
                    type="button"
                    disabled={disableAll}
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
                      className={`grid grid-cols-12 gap-2 rounded-xl border px-2 py-2 ${
                        overCapacity
                          ? "border-rose-300 bg-rose-50/40"
                          : Number(L.qty) > 0 && !L.productId
                          ? "border-amber-300 bg-amber-50/40"
                          : Number(L.qty) <= 0
                          ? "border-slate-200 bg-slate-50 opacity-70"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      {/* Product selector — full width on mobile, 8/12 on ≥sm */}
                      <div className="col-span-12 sm:col-span-8">
                        {readOnly ? (
                          <div className="text-sm text-slate-800 truncate">
                            {L.productId ? `#${L.productId} — ` : ""}
                            {L.name || "—"}
                          </div>
                        ) : (
                          <div className="grid gap-1">
                            <ProductPickerHybridLoadout
                              // no `name` needed; we serialize loadoutJson anyway
                              defaultValue={
                                L.productId
                                  ? { id: L.productId, name: L.name }
                                  : null
                              }
                              placeholder="Type ID or name…"
                              disabled={disableAll}
                              filterRow={(p) => packOnlyIdSet.has(p.id)}
                              categoryOptions={categories ?? []} //
                              onSelect={(p) => {
                                setLoadout((prev) =>
                                  prev.map((x) =>
                                    x.key === L.key
                                      ? {
                                          ...x,
                                          productId: p.id,
                                          name: p.name,
                                          allowDecimal: false, // loadout = PACK only
                                          qty: Number(x.qty) > 0 ? x.qty : 1,
                                        }
                                      : x
                                  )
                                );
                              }}
                            />
                            {L.productId ? (
                              <div className="text-[11px] text-slate-500">
                                SRP:{" "}
                                <span className="tabular-nums">
                                  {peso(srpById.get(L.productId) ?? 0)}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                      {/* Qty — 8/12 on mobile, 3/12 on ≥sm */}
                      <div className="col-span-8 sm:col-span-3">
                        {readOnly ? (
                          <div className="flex justify-start sm:justify-end gap-1 w-full">
                            {L.qty}
                          </div>
                        ) : (
                          <div className="flex items-stretch justify-start sm:justify-end gap-1 w-full">
                            <button
                              type="button"
                              disabled={disableAll}
                              onClick={() => nudgeQty(L.key, -1)}
                              className="h-10 w-10 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 shrink-0"
                              aria-label="Decrease"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              step={L.allowDecimal ? "0.01" : "1"}
                              // Kapag may product na, 0 is not allowed (or treated as remove)
                              value={L.qty}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                const val = isNaN(raw) ? 0 : raw;
                                if (L.productId) {
                                  // may product: 0 ⇒ alisin ang row para klaro ang UX
                                  if (val <= 0) {
                                    setLoadout((prev) =>
                                      prev.filter((x) => x.key !== L.key)
                                    );
                                  } else {
                                    setLoadout((prev) =>
                                      prev.map((x) =>
                                        x.key === L.key ? { ...x, qty: val } : x
                                      )
                                    );
                                  }
                                } else {
                                  // wala pang product: allow 0 bilang placeholder
                                  setLoadout((prev) =>
                                    prev.map((x) =>
                                      x.key === L.key
                                        ? { ...x, qty: Math.max(0, val) }
                                        : x
                                    )
                                  );
                                }
                              }}
                              inputMode={L.allowDecimal ? "decimal" : "numeric"}
                              className={[
                                // size: match buttons
                                "h-10 w-full max-w-[7rem]",
                                // base
                                "rounded-md border border-slate-300 bg-white px-3 text-sm text-right",
                                "outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200",
                                // remove native spinners (cross-browser)
                                "[appearance:textfield]", // modern browsers (incl. Firefox)
                                "[-moz-appearance:textfield]", // Firefox explicit
                                "[&::-webkit-inner-spin-button]:appearance-none", // Chrome/Safari
                                "[&::-webkit-outer-spin-button]:appearance-none",
                              ].join(" ")}
                            />
                            <button
                              type="button"
                              disabled={disableAll}
                              onClick={() => nudgeQty(L.key, +1)}
                              className="h-10 w-10 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 shrink-0"
                              aria-label="Increase"
                            >
                              +
                            </button>
                          </div>
                        )}

                        {L.productId && Number(L.qty) > 0 ? (
                          <div className="mt-1 text-[11px] text-slate-500 text-right">
                            Line:{" "}
                            <span className="tabular-nums">
                              {peso(
                                (srpById.get(L.productId) ?? 0) *
                                  (Number(L.qty) || 0)
                              )}
                            </span>
                          </div>
                        ) : Number(L.qty) > 0 ? (
                          <div className="mt-1 text-[11px] text-amber-700 text-right">
                            Select a product for this line.
                          </div>
                        ) : null}
                      </div>
                      {/* Remove — 4/12 on mobile, 1/12 on ≥sm */}
                      <div className="col-span-4 sm:col-span-1 text-right">
                        {!readOnly && (
                          <button
                            type="button"
                            disabled={disableAll}
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
              {/* removed: hybrid picker handles search + browse */}
            </div>
          </div>

          {/* Loadout Summary (SRP preview) */}
          <div className="rounded-xl border border-slate-200 p-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-700">Loadout SRP Total</div>
              <div className="text-sm font-semibold">{peso(loadoutValue)}</div>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Preview only • based on SRP; actual receipts may differ.
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
            <input type="hidden" name="loadoutJson" value={serializedLoadout} />
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
                  disabled={!hasRider || overCapacity || hasUnboundLoad}
                  title={
                    !hasRider
                      ? "Choose a rider first"
                      : overCapacity
                      ? "Capacity exceeded — adjust loadout or vehicle"
                      : hasUnboundLoad
                      ? "Complete the loadout: select products for lines with quantity"
                      : "Ready to dispatch (server checks coming next)"
                  }
                  className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Dispatch & Print
                </button>
              </>
            ) : (
              <a
                href={`/orders/${order.id}/ticket?autoprint=1&autoback=1`}
                className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm"
              >
                Reprint Ticket
              </a>
            )}
          </Form>
        </div>
      </div>
    </div>
  );
}
