// app/routes/customers._index.tsx
import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, Form } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { db } from "~/utils/db.server";

// ----- Types used by the component (no `typeof loader` needed)
type LoaderData = {
  rows: Array<{
    id: number;
    firstName: string;
    middleName: string | null;
    lastName: string;
    alias: string | null;
    phone: string | null;
  }>;
  q: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  let where: Prisma.CustomerWhereInput | undefined;

  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      where = {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { middleName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { alias: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      };
    } else {
      where = {
        AND: tokens.map<Prisma.CustomerWhereInput>((t) => ({
          OR: [
            { firstName: { contains: t, mode: "insensitive" } },
            { middleName: { contains: t, mode: "insensitive" } },
            { lastName: { contains: t, mode: "insensitive" } },
            { alias: { contains: t, mode: "insensitive" } },
            { phone: { contains: t, mode: "insensitive" } },
          ],
        })),
      };
    }
  }

  const rows = await db.customer.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
    },
    take: 100,
  });

  return json<LoaderData>({ rows, q });
}

export default function CustomersIndex() {
  const { rows, q } = useLoaderData<LoaderData>();
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // "/" focuses search (doesn't steal focus from inputs)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        (t as any).isContentEditable
      )
        return;
      e.preventDefault();
      (
        searchRef.current ??
        document.querySelector<HTMLInputElement>('input[name="q"]')
      )?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Sticky header to match kiosk/cashier */}
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Customers
          </h1>
          <Link
            to="/customers/new"
            className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            New Customer
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-6">
        {/* Search */}
        <Form method="get" className="mb-4">
          <input
            ref={searchRef}
            name="q"
            defaultValue={q}
            placeholder="Search name / alias / phone…  (tip: press “/” to focus)"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 shadow-sm"
          />
        </Form>

        {/* Results card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-medium text-slate-700">
              {q ? <>Results for “{q}”</> : "All customers"}
            </div>
            <div className="text-[11px] text-slate-500">
              {rows.length} item(s)
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">No matches.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((c) => {
                const name = [c.firstName, c.middleName, c.lastName]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={c.id} className="px-4 py-3 hover:bg-slate-50/60">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {name}
                          {c.alias ? (
                            <span className="ml-2 text-xs text-slate-500">
                              ({c.alias})
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-500">
                          {c.phone ?? "—"}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Link
                          to={`/customers/${c.id}`}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                          title="Profile"
                        >
                          Profile
                        </Link>
                        <Link
                          to={`/ar/customers/${c.id}`}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                          title="AR / Ledger"
                        >
                          AR / Ledger
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer tip line like other pages */}
        <div className="mt-3 text-[11px] text-slate-500">
          Tips: press <kbd className="rounded border px-1">/</kbd> to focus
          search • use name, alias, or phone
        </div>
      </div>
    </main>
  );
}
