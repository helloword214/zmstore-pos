import type { PrismaClient } from "@prisma/client";
import { PriceMode, UnitKind } from "@prisma/client";

/**
 * Compute the allowed unit price for a product for a specific customer.
 * If no rule applies, return base price.
 */
export async function computeUnitPriceForCustomer(
  db: PrismaClient,
  args: {
    customerId: number | null;
    productId: number;
    unitKind: UnitKind; // RETAIL or PACK
    baseUnitPrice: number; // product.price (retail) or product.srp (pack)
    now?: Date;
  }
): Promise<number> {
  const { customerId, productId, unitKind, baseUnitPrice } = args;
  const now = args.now ?? new Date();

  if (!customerId) return +Number(baseUnitPrice || 0).toFixed(2);

  const rule = await db.customerItemPrice.findFirst({
    where: {
      customerId,
      productId,
      unitKind,
      active: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: { createdAt: "desc" },
  });

  if (!rule) return +Number(baseUnitPrice || 0).toFixed(2);

  let price = Number(baseUnitPrice || 0);
  const v = Number(rule.value || 0);

  switch (rule.mode) {
    case PriceMode.FIXED_PRICE:
      price = v;
      break;
    case PriceMode.FIXED_DISCOUNT:
      price = price - v;
      break;
    case PriceMode.PERCENT_DISCOUNT:
      price = price - price * (v / 100);
      break;
  }

  if (!Number.isFinite(price) || price < 0) price = 0;
  return +price.toFixed(2);
}

/* pricing.ts — single source of truth for discounts & promos
   Pure functions. No DB calls. Feed it the cart + active rules + customer ctx.
*/

export type Money = number; // pesos, keep 2 decimals across public surfaces

export type CartItem = {
  id: number; // orderItemId or temp id
  productId: number;
  name: string;
  qty: number; // e.g. 2 or 2.5 (kilos)
  unitPrice: Money; // before discounts
  categoryId?: number | null;
  brandId?: number | null;
  sku?: string | null;
};

export type Cart = {
  items: CartItem[];
};

export type CustomerCtx = {
  id?: number | null;
  tags?: string[]; // e.g. ["Suki","Senior","PWD","Employee"]
  isSenior?: boolean; // convenience flags (optional)
  isPWD?: boolean;
};

export type RuleScope = "ORDER" | "ITEM";
export type RuleKind =
  | "PERCENT_OFF" // percent off items or order
  | "AMOUNT_OFF" // fixed peso off items or order
  | "BUY_X_GET_Y" // BxGy (free/discounted items)
  | "PRICE_OVERRIDE"; // set a specific price for matched items

export type ApplyLimit = {
  oncePerOrder?: boolean; // true -> apply only once overall
  maxApplications?: number; // cap applications (e.g., 1 freebie only)
};

export type ProductSelector = {
  productIds?: number[];
  categoryIds?: number[];
  brandIds?: number[];
  skuIncludes?: string[]; // any match
  excludeProductIds?: number[];
};

export type Eligibility = {
  activeFrom?: string; // ISO date or datetime
  activeUntil?: string; // exclusive
  daysOfWeek?: number[]; // 0=Sun..6=Sat
  minSpend?: Money; // cart subtotal requirement
  customerIds?: number[];
  customerTagsAny?: string[]; // at least one tag
};

export type Rule = {
  id: string;
  name: string;
  priority?: number; // lower first
  enabled?: boolean;

  scope: RuleScope;
  kind: RuleKind;
  percentOff?: number; // 0-100 (for PERCENT_OFF)
  amountOff?: Money; // pesos (for AMOUNT_OFF)
  priceOverride?: Money; // pesos (for PRICE_OVERRIDE)

  // BUY_X_GET_Y
  buyQty?: number;
  getQty?: number;
  getProductId?: number | "same"; // "same" => same product as the buy
  discountPercentOnGet?: number; // default 100 = free

  selector?: ProductSelector; // which items the rule can touch (for ITEM scope)
  eligibility?: Eligibility; // cart/customer/date gating
  limit?: ApplyLimit;

  stackable?: boolean; // if false, stop further rules when applied
  notes?: string;
};

export type PerItemAdj = { itemId: number; amount: Money };
export type AppliedDiscount = {
  ruleId: string;
  name: string;
  amount: Money; // total discount from this rule (>=0)
  perItem?: PerItemAdj[];
  addedItems?: CartItem[]; // freebies (line items with unitPrice=0)
};

export type PricingResult = {
  subtotal: Money; // sum of qty*unitPrice (original)
  discounts: AppliedDiscount[];
  discountTotal: Money; // sum of all AppliedDiscount.amount
  total: Money; // subtotal - discountTotal
  adjustedItems: Array<CartItem & { effectiveUnitPrice: Money }>;
  addedItems: CartItem[]; // freebies to append to order (qty >= 0)
};

// -------- helpers --------

const round2 = (n: number) => Math.round(n * 100) / 100;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const nowPH = () => new Date(); // caller can inject current time if needed

function isWithinDateWindow(e?: Eligibility | null, now: Date = nowPH()) {
  if (!e) return true;
  if (e.activeFrom) {
    const d = new Date(e.activeFrom);
    if (!(now >= d)) return false;
  }
  if (e.activeUntil) {
    const d = new Date(e.activeUntil);
    if (!(now < d)) return false;
  }
  if (e.daysOfWeek && e.daysOfWeek.length) {
    const dow = now.getDay(); // 0..6
    if (!e.daysOfWeek.includes(dow)) return false;
  }
  return true;
}

function matchCustomer(e?: Eligibility | null, c?: CustomerCtx | null) {
  if (!e) return true;
  if (!c) c = {};

  if (e.customerIds?.length) {
    if (!c.id || !e.customerIds.includes(c.id)) return false;
  }
  if (e.customerTagsAny?.length) {
    const have = new Set((c.tags || []).map((t) => t.toLowerCase()));
    const ok = e.customerTagsAny.some((t) => have.has(t.toLowerCase()));
    if (!ok) return false;
  }
  return true;
}

function cartSubtotal(cart: Cart) {
  return round2(sum(cart.items.map((it) => round2(it.qty * it.unitPrice))));
}

function itemMatchesSelector(it: CartItem, sel?: ProductSelector) {
  if (!sel) return true;
  if (
    sel.productIds &&
    sel.productIds.length &&
    !sel.productIds.includes(it.productId)
  )
    return false;
  if (
    sel.categoryIds &&
    sel.categoryIds.length &&
    !sel.categoryIds.includes(it.categoryId ?? -1)
  )
    return false;
  if (
    sel.brandIds &&
    sel.brandIds.length &&
    !sel.brandIds.includes(it.brandId ?? -1)
  )
    return false;
  if (sel.skuIncludes && sel.skuIncludes.length) {
    const sku = (it.sku || "").toLowerCase();
    const ok = sel.skuIncludes.some((frag) => sku.includes(frag.toLowerCase()));
    if (!ok) return false;
  }
  if (sel.excludeProductIds && sel.excludeProductIds.includes(it.productId))
    return false;
  return true;
}

function eligible(
  rule: Rule,
  cart: Cart,
  ctx?: CustomerCtx,
  now = nowPH()
): { ok: boolean; reason?: string } {
  if (rule.enabled === false) return { ok: false, reason: "disabled" };
  if (!isWithinDateWindow(rule.eligibility, now))
    return { ok: false, reason: "date" };
  if (!matchCustomer(rule.eligibility, ctx))
    return { ok: false, reason: "customer" };
  const sub = cartSubtotal(cart);
  if (rule.eligibility?.minSpend && sub + 1e-9 < rule.eligibility.minSpend) {
    return { ok: false, reason: "minSpend" };
  }
  return { ok: true };
}

function byPriority(a: Rule, b: Rule) {
  const pa = a.priority ?? 1000;
  const pb = b.priority ?? 1000;
  return pa - pb;
}

// Compute a per-item discount map (itemId -> amount) for simple kinds.
function computeItemLevel(
  kind: RuleKind,
  items: CartItem[],
  selector?: ProductSelector,
  args?: { percentOff?: number; amountOff?: Money; priceOverride?: Money }
): PerItemAdj[] {
  const result: PerItemAdj[] = [];
  const matched = items.filter((it) => itemMatchesSelector(it, selector));

  if (kind === "PRICE_OVERRIDE") {
    const price = args?.priceOverride ?? 0;
    for (const it of matched) {
      const current = it.unitPrice;
      const delta = Math.max(0, round2(current - price)); // discount to reach override
      if (delta > 0) {
        result.push({ itemId: it.id, amount: round2(delta * it.qty) });
      }
    }
  } else if (kind === "PERCENT_OFF") {
    const pct = Math.max(0, Math.min(100, args?.percentOff ?? 0));
    if (pct <= 0) return [];
    for (const it of matched) {
      const base = round2(it.unitPrice * it.qty);
      const off = round2((pct / 100) * base);
      if (off > 0) result.push({ itemId: it.id, amount: off });
    }
  } else if (kind === "AMOUNT_OFF") {
    const amt = Math.max(0, args?.amountOff ?? 0);
    if (amt <= 0) return [];
    // distribute equally proportional to line totals
    const lines = matched.map((it) => ({
      it,
      line: round2(it.qty * it.unitPrice),
    }));
    const total = sum(lines.map((x) => x.line));
    if (total <= 0) return [];
    for (const x of lines) {
      const share = round2((x.line / total) * amt);
      if (share > 0) result.push({ itemId: x.it.id, amount: share });
    }
  }

  return result;
}

function cloneAdjusted(
  items: CartItem[],
  adjustments: Map<number, Money>
): Array<CartItem & { effectiveUnitPrice: Money }> {
  // adjust unit prices by spreading discount over qty (to display effective price)
  return items.map((it) => {
    const adj = adjustments.get(it.id) ?? 0;
    const perUnitMinus = it.qty > 0 ? round2(adj / it.qty) : 0;
    const eff = Math.max(0, round2(it.unitPrice - perUnitMinus));
    return { ...it, effectiveUnitPrice: eff };
  });
}

// -------- main entry point --------

export function applyDiscounts(
  cart: Cart,
  rules: Rule[],
  ctx?: CustomerCtx,
  opts?: { now?: Date }
): PricingResult {
  const now = opts?.now ?? nowPH();

  const subtotal = cartSubtotal(cart);

  const ordered = [...rules].sort(byPriority);

  const perItemDiscounts = new Map<number, Money>(); // itemId -> total amount
  const applied: AppliedDiscount[] = [];
  const freebies: CartItem[] = [];

  const addPerItem = (adj: PerItemAdj[]) => {
    for (const a of adj) {
      perItemDiscounts.set(
        a.itemId,
        round2((perItemDiscounts.get(a.itemId) ?? 0) + a.amount)
      );
    }
  };

  for (const rule of ordered) {
    const gate = eligible(rule, cart, ctx, now);
    if (!gate.ok) continue;

    if (rule.scope === "ITEM") {
      if (rule.kind === "BUY_X_GET_Y") {
        const buy = Math.max(1, Math.floor(rule.buyQty ?? 0));
        const get = Math.max(1, Math.floor(rule.getQty ?? 0));
        if (buy <= 0 || get <= 0) continue;

        // group by product (selector still filters which products count as a "buy")
        const candidates = cart.items.filter((it) =>
          itemMatchesSelector(it, rule.selector)
        );
        if (!candidates.length) continue;

        let applications = 0;
        const maxApps = rule.limit?.oncePerOrder
          ? 1
          : rule.limit?.maxApplications ?? Number.POSITIVE_INFINITY;

        for (const it of candidates) {
          if (applications >= maxApps) break;

          const eligibleSets = Math.floor(it.qty / buy);
          if (eligibleSets <= 0) continue;

          const toApply = Math.min(eligibleSets, maxApps - applications);
          applications += toApply;

          // where does the “get” apply?
          const getPid = rule.getProductId ?? "same";
          const pct = Math.min(
            100,
            Math.max(0, rule.discountPercentOnGet ?? 100)
          );

          if (getPid === "same") {
            // free (or discounted) units of the same item
            const qtyFree = round2(get * toApply);
            const discount = round2(qtyFree * it.unitPrice * (pct / 100));
            if (discount > 0) {
              addPerItem([{ itemId: it.id, amount: discount }]);
              applied.push({
                ruleId: rule.id,
                name: rule.name,
                amount: discount,
                perItem: [{ itemId: it.id, amount: discount }],
              });
              if (pct >= 100) {
                // represent as discounted line (not a new free line) — we already applied per-item discount
              }
            }
          } else {
            // free/discounted different product — model as a freebie line
            const freeQty = round2(get * toApply);
            const name = `FREE ${getPid}`;
            const line: CartItem = {
              id: -Date.now() - applied.length, // temp id
              productId: getPid as number,
              name,
              qty: freeQty,
              unitPrice: 0,
            };
            freebies.push(line);
            applied.push({
              ruleId: rule.id,
              name: rule.name,
              amount: 0,
              addedItems: [line],
            });
          }
        }
        if (applications > 0 && rule.stackable === false) break;
        continue;
      }

      // Simple item-level types:
      const perItem = computeItemLevel(rule.kind, cart.items, rule.selector, {
        percentOff: rule.percentOff,
        amountOff: rule.amountOff,
        priceOverride: rule.priceOverride,
      });
      const total = round2(sum(perItem.map((x) => x.amount)));
      if (total > 0) {
        addPerItem(perItem);
        applied.push({
          ruleId: rule.id,
          name: rule.name,
          amount: total,
          perItem,
        });
        if (
          rule.limit?.oncePerOrder &&
          applied.filter((a) => a.ruleId === rule.id).length > 0
        ) {
          // already applied once; future iterations are stopped by sorting anyway
        }
        if (rule.stackable === false) break;
      }
    } else if (rule.scope === "ORDER") {
      // compute current interim total (subtotal minus already added per-item discounts)
      const currentItems = cloneAdjusted(cart.items, perItemDiscounts);
      const interimTotal = round2(
        sum(currentItems.map((it) => round2(it.effectiveUnitPrice * it.qty)))
      );

      let discount = 0;
      if (rule.kind === "PERCENT_OFF") {
        const pct = Math.max(0, Math.min(100, rule.percentOff ?? 0));
        discount = round2((pct / 100) * interimTotal);
      } else if (rule.kind === "AMOUNT_OFF") {
        discount = Math.min(interimTotal, Math.max(0, rule.amountOff ?? 0));
      } else {
        // price override & BxGy do not make sense on ORDER scope — ignore
      }

      if (discount > 0) {
        // distribute the order-level discount proportionally over items
        const lines = currentItems.map((it) => ({
          it,
          line: round2(it.effectiveUnitPrice * it.qty),
        }));
        const totalLines = sum(lines.map((l) => l.line)) || 1;
        const perItem: PerItemAdj[] = [];
        let acc = 0;
        for (let i = 0; i < lines.length; i++) {
          const share =
            i === lines.length - 1
              ? round2(discount - acc) // last line gets the remainder
              : round2((lines[i].line / totalLines) * discount);
          acc = round2(acc + share);
          perItem.push({ itemId: lines[i].it.id, amount: share });
        }

        addPerItem(perItem);
        applied.push({
          ruleId: rule.id,
          name: rule.name,
          amount: discount,
          perItem,
        });
        if (rule.stackable === false) break;
      }
    }
  }

  // finalize
  const adjustedItems = cloneAdjusted(cart.items, perItemDiscounts);
  const discountTotal = round2(sum(applied.map((a) => a.amount)));
  const total = Math.max(0, round2(subtotal - discountTotal));

  return {
    subtotal,
    discounts: applied,
    discountTotal,
    total,
    adjustedItems,
    addedItems: freebies,
  };
}

// ---- tiny convenience for one-off calculations in UI ----

export function priceSummary(cart: Cart, rules: Rule[], ctx?: CustomerCtx) {
  const r = applyDiscounts(cart, rules, ctx);
  return {
    subtotal: r.subtotal,
    discountTotal: r.discountTotal,
    total: r.total,
  };
}
