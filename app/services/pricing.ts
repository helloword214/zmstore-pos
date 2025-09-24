/* eslint-disable @typescript-eslint/no-explicit-any */
// app/services/pricing.ts
/* Core pricing types + engine used both in the client preview and server guards */
import type {
  PrismaClient,
  Prisma,
  UnitKind as PrismaUnitKind,
} from "@prisma/client";

// Use a type alias so this file never imports Prisma *values* at runtime.
export type UnitKind = PrismaUnitKind;
// (Alternative kung ayaw mo mag-depende sa Prisma dito:)
// export type UnitKind = "RETAIL" | "PACK";

/** Selectors let a rule target specific products/units (extend as needed). */
export type Selector = {
  productIds?: number[];
  unitKind?: "RETAIL" | "PACK";
  // Optional extras if you want to match by metadata the UI passes through:
  categoryIds?: number[];
  brandIds?: number[];
  sku?: string | null;
};

/** One “cart item” as the UI sees it (unitPrice = base, pre-discount). */
export type CartItem = {
  id: number;
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  unitKind?: "RETAIL" | "PACK";
  categoryId?: number | null;
  brandId?: number | null;
  sku?: string | null;
};

export type Cart = { items: CartItem[] };

export type RuleSelector = {
  productIds?: number[];
  unitKind?: "RETAIL" | "PACK";
};

/** Discount rule (we support PRICE_OVERRIDE + PERCENT_OFF). */
export type Rule =
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

export type AppliedDiscount = {
  ruleId: string;
  name: string;
  amount: number; // total amount applied by this rule (all qty)
};

export type AdjustedItem = {
  id: number;
  productId: number;
  effectiveUnitPrice: number; // after all matching rules
};

export type PricingResult = {
  subtotal: number; // sum of qty * original unitPrice
  discounts: AppliedDiscount[];
  discountTotal: number;
  total: number; // subtotal - discountTotal
  adjustedItems: AdjustedItem[];
};

// Helper: return only rules that match product AND unitKind (or no unitKind specified)
export function resolveApplicableRules(params: {
  productId: number;
  unitKind: UnitKind; // "RETAIL" | "PACK"
  rules: Rule[];
}) {
  const { productId, unitKind, rules } = params;
  return (rules ?? []).filter((r) => {
    const pidOk = r?.selector?.productIds?.includes?.(productId) ?? false;
    const kindOk = !r?.selector?.unitKind || r.selector.unitKind === unitKind;
    return pidOk && kindOk && r?.enabled !== false;
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function matchesSelector(it: CartItem, sel?: Selector): boolean {
  if (!sel) return true;
  if (sel.productIds && !sel.productIds.includes(it.productId)) return false;
  if (sel.unitKind && it.unitKind && sel.unitKind !== it.unitKind) return false;
  if (
    sel.categoryIds &&
    !(sel.categoryIds as number[]).includes((it.categoryId ?? -1) as number)
  )
    return false;
  if (
    sel.brandIds &&
    !(sel.brandIds as number[]).includes((it.brandId ?? -1) as number)
  )
    return false;
  if (sel.sku && it.sku && sel.sku !== it.sku) return false;
  return true;
}

/**
 * applyDiscounts – client/server-safe preview engine.
 * Honors PRICE_OVERRIDE and PERCENT_OFF.
 * - Overrides: pick highest-priority (then stable order), not stackable.
 * - Percents: all matching, sorted by priority (desc), stack multiplicatively.
 * - Aggregates per-rule amounts for the totals panel.
 */
export function applyDiscounts(
  cart: Cart,
  rules: Rule[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx?: { id: number | null } // optional
): PricingResult {
  const active = (rules ?? []).filter((r) => r?.enabled !== false);
  // Stable sort: priority desc, then by id
  const sorted = [...active].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      String(a.id).localeCompare(String(b.id))
  );

  const perRuleTotals = new Map<string, AppliedDiscount>();
  const adjusted: AdjustedItem[] = [];

  let subtotal = 0;
  let totalAfter = 0;

  for (const it of cart.items ?? []) {
    const origUnit = Number(it.unitPrice) || 0;
    const qty = Number(it.qty) || 0;
    subtotal += r2(origUnit * qty);

    // Split rules that match this item
    const matching = sorted.filter((r) => matchesSelector(it, r.selector));

    const override = matching.find(
      (r) => r.kind === "PRICE_OVERRIDE" && Number.isFinite(r.priceOverride)
    );
    const percents = matching.filter(
      (r) => r.kind === "PERCENT_OFF" && Number.isFinite(r.percentOff)
    );

    // Start at original
    let eff = origUnit;

    // Apply a single override if present (highest priority wins)
    if (override && override.kind === "PRICE_OVERRIDE") {
      const next = r2(override.priceOverride);
      const delta = Math.max(0, r2((eff - next) * qty));
      if (delta > 0) {
        const entry = perRuleTotals.get(override.id) ?? {
          ruleId: override.id,
          name: override.name,
          amount: 0,
        };
        entry.amount = r2(entry.amount + delta);
        perRuleTotals.set(override.id, entry);
      }
      eff = next;
      // Overrides are not stackable by default (stackable=false)
    }

    const isOverride = (
      r: Rule
    ): r is Extract<Rule, { kind: "PRICE_OVERRIDE" }> =>
      r.kind === "PRICE_OVERRIDE";
    const isPercent = (r: Rule): r is Extract<Rule, { kind: "PERCENT_OFF" }> =>
      r.kind === "PERCENT_OFF";

    // usage
    if (override && isOverride(override)) {
      /* use override.priceOverride */
    }
    for (const p of percents.filter(isPercent)) {
      /* use p.percentOff */
    }

    // Apply all percentage discounts (stackable, multiplicative)
    for (const p of percents) {
      if (p.kind !== "PERCENT_OFF") continue; // 👈 narrow here
      const pct = Math.max(0, Number(p.percentOff ?? 0));
      if (pct <= 0) continue;
      const next = r2(eff * (1 - pct / 100));
      const delta = Math.max(0, r2((eff - next) * qty));
      if (delta > 0) {
        const entry = perRuleTotals.get(p.id) ?? {
          ruleId: p.id,
          name: p.name,
          amount: 0,
        };
        entry.amount = r2(entry.amount + delta);
        perRuleTotals.set(p.id, entry);
      }
      eff = next;
    }

    adjusted.push({
      id: it.id,
      productId: it.productId,
      effectiveUnitPrice: eff,
    });

    totalAfter += r2(eff * qty);
  }

  const discounts = Array.from(perRuleTotals.values());
  const discountTotal = r2(subtotal - totalAfter);
  return {
    subtotal: r2(subtotal),
    discounts,
    discountTotal,
    total: r2(totalAfter),
    adjustedItems: adjusted,
  };
}

/**
 * computeUnitPriceForCustomer – server-side helper used by cashier action
 * to determine the **allowed** unit price for one product/unitKind.
 * It reproduces the same rule semantics: pick one override (highest priority),
 * then apply all % discounts.
 */
export async function computeUnitPriceForCustomer(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    customerId: number | null;
    productId: number;
    unitKind: UnitKind; // "RETAIL" | "PACK"
    baseUnitPrice: number; // product.price or product.srp (pre-discount)
  }
): Promise<number> {
  const { customerId, productId, unitKind, baseUnitPrice } = params;
  if (!customerId || !productId || !baseUnitPrice) return r2(baseUnitPrice);

  const now = new Date();
  const rows = await db.customerItemPrice.findMany({
    where: {
      customerId,
      productId,
      unitKind,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    select: { id: true, mode: true, value: true },
    orderBy: [{ createdAt: "desc" }],
  });

  if (!rows.length) return r2(baseUnitPrice);

  // Convert DB rows → in-memory rules for a single product/unitKind
  const rules: Rule[] = rows.map((r) => {
    const v = Number(r.value ?? 0);
    if (r.mode === "FIXED_PRICE") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer Price",
        scope: "ITEM",
        kind: "PRICE_OVERRIDE",
        priceOverride: v,
        selector: { productIds: [productId], unitKind: unitKind as any },
        priority: 10,
        enabled: true,
        stackable: false,
      };
    }
    if (r.mode === "PERCENT_DISCOUNT") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer % Off",
        scope: "ITEM",
        kind: "PERCENT_OFF",
        percentOff: v,
        selector: { productIds: [productId], unitKind: unitKind as any },
        priority: 10,
        enabled: true,
        stackable: true,
      };
    }
    // FIXED_DISCOUNT → convert to an override from base
    const override = Math.max(0, r2(baseUnitPrice - v));
    return {
      id: `CIP:${r.id}`,
      name: "Customer Fixed Off",
      scope: "ITEM",
      kind: "PRICE_OVERRIDE",
      priceOverride: override,
      selector: { productIds: [productId], unitKind: unitKind as any },
      priority: 10,
      enabled: true,
      stackable: false,
    };
  });

  // Run a single-item cart through the same engine for correctness
  const one: Cart = {
    items: [
      {
        id: 0,
        productId,
        name: "",
        qty: 1,
        unitPrice: baseUnitPrice,
        unitKind: unitKind as any,
      },
    ],
  };
  const out = applyDiscounts(one, rules, { id: customerId });
  const eff = out.adjustedItems[0]?.effectiveUnitPrice ?? baseUnitPrice;
  return r2(eff);
}

// ─────────────────────────────────────────────────────────────
// NEW: Shared helpers to centralize pricing/disc logic
// ─────────────────────────────────────────────────────────────

/** Query all active, unit-aware customer rules and map -> Rule[] */
export async function fetchActiveCustomerRules(
  db: PrismaClient | Prisma.TransactionClient,
  customerId: number | null
): Promise<Rule[]> {
  if (!customerId) return [];

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
      unitKind: true,
      mode: true,
      value: true,
      product: { select: { price: true, srp: true } }, // for FIXED_DISCOUNT base
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const rules: Rule[] = rows.map((r) => {
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
        priceOverride: r2(v),
        selector,
        priority: 10,
        enabled: true,
        stackable: false,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    }

    if (r.mode === "PERCENT_DISCOUNT") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer % Off",
        scope: "ITEM",
        kind: "PERCENT_OFF",
        percentOff: r2(v),
        selector,
        priority: 10,
        enabled: true,
        stackable: true,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    }

    // FIXED_DISCOUNT → convert using base for that unit kind
    const base =
      r.unitKind === "RETAIL"
        ? Number(r.product?.price ?? 0)
        : Number(r.product?.srp ?? 0);
    const override = Math.max(0, r2(base - v));
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
    } as Rule;
  });

  return rules;
}

/** Fetch customer rules that were valid at a specific time (e.g., receipt paidAt). */
export async function fetchCustomerRulesAt(
  db: PrismaClient | Prisma.TransactionClient,
  customerId: number | null,
  at: Date
): Promise<Rule[]> {
  if (!customerId) return [];

  const rows = await db.customerItemPrice.findMany({
    where: {
      customerId,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
      ],
    },
    select: {
      id: true,
      productId: true,
      unitKind: true,
      mode: true,
      value: true,
      product: { select: { price: true, srp: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return rows.map((r) => {
    const selector: RuleSelector = {
      productIds: [r.productId],
      unitKind: r.unitKind as "RETAIL" | "PACK",
    };
    const v = Number(r.value ?? 0);
    if (r.mode === "PERCENT_DISCOUNT") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer % Off",
        scope: "ITEM",
        kind: "PERCENT_OFF",
        percentOff: r2(v),
        selector,
        priority: 10,
        enabled: true,
        stackable: true,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    }
    if (r.mode === "FIXED_PRICE") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer Price",
        scope: "ITEM",
        kind: "PRICE_OVERRIDE",
        priceOverride: r2(v),
        selector,
        priority: 10,
        enabled: true,
        stackable: false,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    }
    // FIXED_DISCOUNT -> use correct base
    const base =
      r.unitKind === "RETAIL"
        ? Number(r.product?.price ?? 0)
        : Number(r.product?.srp ?? 0);
    const override = Math.max(0, r2(base - v));
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
    } as Rule;
  });
}

/**
 * Infer the unit kind by comparing unitPrice to base prices, then
 * falling back to which unit the rules target for that product.
 */
export function inferUnitKindFromPriceAndRules(args: {
  unitPrice: number;
  productBaseRetail: number; // product.price
  productBasePack: number; // product.srp
  allowPackSale?: boolean | null;
  rules: Rule[];
  productId: number;
  epsForBaseCompare?: number; // default 0.25
}): "RETAIL" | "PACK" | undefined {
  const {
    unitPrice,
    productBaseRetail,
    productBasePack,
    allowPackSale,
    rules,
    productId,
    epsForBaseCompare = 0.25,
  } = args;

  const eq = (a: number, b: number, eps = 0.25) => Math.abs(a - b) <= eps;
  const hasRetailBase =
    (allowPackSale ?? true) &&
    productBaseRetail > 0 &&
    Number.isFinite(productBaseRetail);
  const hasPackBase = productBasePack > 0 && Number.isFinite(productBasePack);

  const retailClose =
    hasRetailBase && eq(unitPrice, productBaseRetail, epsForBaseCompare);
  const packClose =
    hasPackBase && eq(unitPrice, productBasePack, epsForBaseCompare);

  if (retailClose && !packClose) return "RETAIL";
  if (packClose && !retailClose) return "PACK";
  if (retailClose && packClose)
    return productBaseRetail <= productBasePack ? "RETAIL" : "PACK";

  // Rule-aware fallback
  const hasPackRule = rules.some(
    (r) =>
      r.selector?.unitKind === "PACK" &&
      r.selector?.productIds?.includes(productId)
  );
  const hasRetailRule = rules.some(
    (r) =>
      r.selector?.unitKind === "RETAIL" &&
      r.selector?.productIds?.includes(productId)
  );
  if (hasPackRule && !hasRetailRule) return "PACK";
  if (hasRetailRule && !hasPackRule) return "RETAIL";
  return undefined;
}

/** Build a Cart from order items using the shared inference above */
export function buildCartFromOrderItems(args: {
  items: Array<{
    id: number;
    productId: number;
    name: string;
    qty: number | string;
    unitPrice: number | string;
    product?: {
      price: number | null;
      srp: number | null;
      allowPackSale: boolean | null;
      categoryId?: number | null;
      brandId?: number | null;
      sku?: string | null;
    } | null;
  }>;
  rules: Rule[];
}): Cart {
  const { items, rules } = args;
  return {
    items: (items ?? []).map((it) => {
      const baseRetail = Number(it.product?.price ?? 0);
      const basePack = Number(it.product?.srp ?? 0);
      const allowPackSale = Boolean(it.product?.allowPackSale ?? true);
      const u = Number(it.unitPrice);

      const unitKind = inferUnitKindFromPriceAndRules({
        unitPrice: u,
        productBaseRetail: baseRetail,
        productBasePack: basePack,
        allowPackSale,
        rules,
        productId: it.productId,
      });

      return {
        id: it.id,
        productId: it.productId,
        name: it.name,
        qty: Number(it.qty),
        unitPrice: u,
        unitKind,
        categoryId: it.product?.categoryId ?? null,
        brandId: it.product?.brandId ?? null,
        sku: it.product?.sku ?? null,
      };
    }),
  };
}
