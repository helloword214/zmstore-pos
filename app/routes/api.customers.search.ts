import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import type { Prisma } from "@prisma/client";
import { toE164PH, toE164PrefixForContains, digitsOnly } from "~/utils/phone";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ hits: [] });

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return json({ hits: [] });

  const e164Exact = toE164PH(q); // exact number if full
  const e164Prefix = toE164PrefixForContains(q); // for startsWith / contains
  const hasPhoneHint = !!digitsOnly(q);

  // Build a strongly-typed Prisma where input
  const nameOrAliasBlocks: Prisma.CustomerWhereInput[] = tokens.map((t) => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { alias: { contains: t, mode: "insensitive" } },
    ],
  }));

  // We can't "rank" inside Prisma easily, so fetch a broader set:
  // - any name/alias token match
  // - OR phone equals/startsWith/contains normalized hints
  const phoneOrs: Prisma.CustomerWhereInput[] = [];
  if (e164Exact) phoneOrs.push({ phone: { equals: e164Exact } });
  if (e164Prefix) {
    phoneOrs.push({ phone: { startsWith: e164Prefix } });
    // also allow contains to catch mid-typing
    phoneOrs.push({ phone: { contains: e164Prefix.replace("+", "") } });
    phoneOrs.push({ phone: { contains: e164Prefix } });
  }

  const where: Prisma.CustomerWhereInput = {
    OR: [
      ...(nameOrAliasBlocks.length ? [{ AND: nameOrAliasBlocks }] : []),
      ...(phoneOrs.length ? phoneOrs : []),
      // Fallback: if user typed bare digits and we can't normalize yet,
      // still try a loose contains to avoid zero-results.
      ...(hasPhoneHint ? [{ phone: { contains: digitsOnly(q) } }] : []),
    ],
    // isActive: true,
  };

  const rows = await db.customer.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      addresses: {
        select: {
          id: true,
          label: true,
          line1: true,
          barangay: true,
          city: true,
          province: true,
          landmark: true,
          geoLat: true,
          geoLng: true,
          photoUrl: true,
          photoUpdatedAt: true,
        },
        orderBy: [{ photoUpdatedAt: "desc" }, { id: "desc" }],
        take: 2,
      },
    },
    // Pull a bit more; we'll score/sort client-side
    take: 25,
  });
  // Rank results: phone exact > startsWith > contains > name/alias matches
  const lower = q.toLowerCase();
  const nameTokens = tokens.map((t) => t.toLowerCase());
  type Row = (typeof rows)[number] & { _score?: number };
  const scored: Row[] = rows.map((r) => {
    let score = 0;
    // Phone scores
    if (e164Exact && r.phone === e164Exact) score += 100;
    else if (e164Prefix && r.phone?.startsWith(e164Prefix)) score += 60;
    else if (e164Prefix && r.phone?.includes(e164Prefix)) score += 30;
    else if (hasPhoneHint && r.phone?.includes(digitsOnly(q))) score += 20;

    // Name / alias matches
    const nameBag = `${r.firstName} ${r.middleName ?? ""} ${r.lastName} ${
      r.alias ?? ""
    }`.toLowerCase();
    for (const t of nameTokens) {
      if (nameBag.includes(t)) score += 10;
      if ((r.alias ?? "").toLowerCase().startsWith(t)) score += 5;
    }

    // Small boost if they have a reasonably complete address
    const a = r.addresses?.[0];
    if (a && a.line1 && a.city && a.province) score += 5;
    return { ...r, _score: score };
  });

  scored.sort((a, b) => {
    if ((b._score ?? 0) !== (a._score ?? 0))
      return (b._score ?? 0) - (a._score ?? 0);
    // tie-breaker: lastName, firstName
    const ln = String(a.lastName).localeCompare(String(b.lastName));
    if (ln !== 0) return ln;
    return String(a.firstName).localeCompare(String(b.firstName));
  });

  const items = scored.slice(0, 10).map((r) => ({
    id: r.id,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    alias: r.alias,
    phone: r.phone,
    addresses: r.addresses,
  }));

  return json({ hits: items });
}
