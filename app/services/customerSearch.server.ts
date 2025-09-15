import type { Prisma } from "@prisma/client";
import { toE164PH, toE164PrefixForContains, digitsOnly } from "~/utils/phone";

export type CustomerSearchOptions = {
  q: string;
  mustHaveOpenOrders?: boolean; // for AR pages
};

export function buildCustomerSearchWhere({
  q,
  mustHaveOpenOrders,
}: CustomerSearchOptions): Prisma.CustomerWhereInput {
  const query = (q || "").trim();
  if (!query)
    return mustHaveOpenOrders
      ? { orders: { some: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } } }
      : {};

  const tokens = query.split(/\s+/).filter(Boolean);
  const e164Exact = toE164PH(query);
  const e164Prefix = toE164PrefixForContains(query);
  const hasPhoneHint = !!digitsOnly(query);

  const nameOrAliasBlocks: Prisma.CustomerWhereInput[] = tokens.map((t) => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" } },
      { middleName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { alias: { contains: t, mode: "insensitive" } },
    ],
  }));

  const phoneOrs: Prisma.CustomerWhereInput[] = [];
  if (e164Exact) phoneOrs.push({ phone: { equals: e164Exact } });
  if (e164Prefix) {
    phoneOrs.push({ phone: { startsWith: e164Prefix } });
    phoneOrs.push({ phone: { contains: e164Prefix.replace("+", "") } });
    phoneOrs.push({ phone: { contains: e164Prefix } });
  }
  if (hasPhoneHint) phoneOrs.push({ phone: { contains: digitsOnly(query) } });

  const or: Prisma.CustomerWhereInput[] = [];
  if (nameOrAliasBlocks.length) or.push({ AND: nameOrAliasBlocks });
  if (phoneOrs.length) or.push(...phoneOrs);

  const base: Prisma.CustomerWhereInput = or.length ? { OR: or } : {};
  return mustHaveOpenOrders
    ? {
        AND: [
          base,
          {
            orders: { some: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } },
          },
        ],
      }
    : base;
}

export function scoreAndSortCustomers<
  T extends {
    firstName: string;
    middleName: string | null;
    lastName: string;
    alias: string | null;
    phone: string | null;
  }
>(rows: T[], q: string) {
  const query = (q || "").trim();
  if (!query) return rows;
  const tokens = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  const e164Exact = toE164PH(query);
  const e164Prefix = toE164PrefixForContains(query);
  const hasPhoneHint = !!digitsOnly(query);

  return [...rows]
    .map((r) => {
      let score = 0;
      if (e164Exact && r.phone === e164Exact) score += 100;
      else if (e164Prefix && (r.phone || "").startsWith(e164Prefix))
        score += 60;
      else if (e164Prefix && (r.phone || "").includes(e164Prefix)) score += 30;
      else if (hasPhoneHint && (r.phone || "").includes(digitsOnly(query)))
        score += 20;
      const bag = `${r.firstName} ${r.middleName ?? ""} ${r.lastName} ${
        r.alias ?? ""
      }`.toLowerCase();
      for (const t of tokens) {
        if (bag.includes(t)) score += 10;
        if ((r.alias ?? "").toLowerCase().startsWith(t)) score += 5;
      }
      return { r, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ln = String(a.r.lastName).localeCompare(String(b.r.lastName));
      if (ln !== 0) return ln;
      return String(a.r.firstName).localeCompare(String(b.r.firstName));
    })
    .map((x) => x.r);
}
