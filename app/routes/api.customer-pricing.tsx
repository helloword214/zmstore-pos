// app/routes/api.customer-pricing.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

// Local shape the UI expects. This avoids importing types from services/pricing.
type RuleSelector = {
  productIds?: number[];
  unitKind?: "RETAIL" | "PACK";
};

type ApiRule =
  | {
      id: string;
      name: string;
      scope: "ITEM";
      kind: "PRICE_OVERRIDE";
      priceOverride: number;
      selector?: RuleSelector;
      priority?: number;
      enabled?: boolean;
      stackable?: boolean;
      notes?: string;
    }
  | {
      id: string;
      name: string;
      scope: "ITEM";
      kind: "PERCENT_OFF";
      percentOff: number;
      selector?: RuleSelector;
      priority?: number;
      enabled?: boolean;
      stackable?: boolean;
      notes?: string;
    };

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const customerId = Number(url.searchParams.get("customerId") || 0);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return json({ rules: [] as ApiRule[] }, { status: 200 });
  }

  const now = new Date();
  const rows = await db.customerItemPrice.findMany({
    where: {
      customerId,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    select: {
      id: true,
      productId: true,
      unitKind: true, // "RETAIL" | "PACK"
      mode: true, // "FIXED_PRICE" | "FIXED_DISCOUNT" | "PERCENT_DISCOUNT"
      value: true,
      product: { select: { price: true, srp: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const rules: ApiRule[] = rows.map((r) => {
    const selector: RuleSelector = {
      productIds: [r.productId],
      unitKind: r.unitKind as "RETAIL" | "PACK",
    };
    const v = Number(r.value ?? 0);

    if (r.mode === "FIXED_PRICE") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer Price",
        scope: "ITEM",
        kind: "PRICE_OVERRIDE",
        priceOverride: v,
        selector,
        priority: 10,
        enabled: true,
        stackable: false,
        notes: `unit=${r.unitKind}`,
      };
    }

    if (r.mode === "PERCENT_DISCOUNT") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer % Off",
        scope: "ITEM",
        kind: "PERCENT_OFF",
        percentOff: v,
        selector,
        priority: 10,
        enabled: true,
        stackable: true,
        notes: `unit=${r.unitKind}`,
      };
    }

    // FIXED_DISCOUNT → convert to price override based on correct base
    const base =
      r.unitKind === "RETAIL"
        ? Number(r.product.price ?? 0)
        : Number(r.product.srp ?? 0);
    const override = Math.max(0, +(base - v).toFixed(2));

    return {
      id: `CIP:${r.id}`,
      name: "Customer Fixed Off",
      scope: "ITEM",
      kind: "PRICE_OVERRIDE",
      priceOverride: override,
      selector,
      priority: 10,
      enabled: true,
      stackable: false,
      notes: `unit=${r.unitKind}`,
    };
  });

  console.log(
    "DBG: api.customer-pricing",
    JSON.stringify(
      { customerId, count: rules.length, sample: rules.slice(0, 1) },
      null,
      2
    )
  );

  return json({ rules });
}
