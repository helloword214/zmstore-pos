// app/routes/customers._index.tsx
import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  Form,
  useSubmit,
  useFetcher,
} from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

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
  ctx: "admin" | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const ctx = url.searchParams.get("ctx") === "admin" ? "admin" : null;

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

  return json<LoaderData>({ rows, q, ctx });
}

export default function CustomersIndex() {
  const { rows, q, ctx } = useLoaderData<LoaderData>();
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const submit = useSubmit();
  const searchFx = useFetcher<{
    hits: Array<{
      id: number;
      firstName: string;
      middleName: string | null;
      lastName: string;
      alias: string | null;
      phone: string | null;
      addresses?: unknown[];
    }>;
  }>();
  const [query, setQuery] = React.useState(q);
  const [debounceId, setDebounceId] = React.useState<number | null>(null);
  const ctxSuffix = ctx === "admin" ? "?ctx=admin" : "";

  // "/" focuses search (doesn't steal focus from inputs)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
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

  // Kick an initial API search if we landed with ?q=
  React.useEffect(() => {
    if (!q) return;
    searchFx.load(`/api/customers/search?q=${encodeURIComponent(q)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render source: prefer API hits (live), else loader rows (initial)
  const live = searchFx.data?.hits ?? null;
  const list = (live && query.trim() ? live : rows) as Array<{
    id: number;
    firstName: string;
    middleName: string | null;
    lastName: string;
    alias: string | null;
    phone: string | null;
  }>;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Customers"
        subtitle="Browse and manage customer profiles for pricing and operations."
        backTo={ctx === "admin" ? "/" : "/store"}
        backLabel="Dashboard"
        maxWidthClassName="max-w-4xl"
      />

      <div className="mx-auto max-w-4xl px-5 py-6">
        <SoTActionBar
          right={
            <Link
              to={`/customers/new${ctxSuffix}`}
              className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              New Customer
            </Link>
          }
        />

        <SoTCard interaction="form" className="mb-4">
          <Form
            method="get"
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              submit(formRef.current!, { method: "get", replace: true });
            }}
          >
            {ctx === "admin" ? (
              <input type="hidden" name="ctx" value="admin" />
            ) : null}
            <input
              ref={searchRef}
              name="q"
              type="search"
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                if (debounceId) window.clearTimeout(debounceId);
                const id = window.setTimeout(() => {
                  submit(formRef.current!, { method: "get", replace: true });
                  if (v.trim()) {
                    searchFx.load(
                      `/api/customers/search?q=${encodeURIComponent(v.trim())}`
                    );
                  }
                }, 250);
                setDebounceId(id);
              }}
              placeholder="Search name / alias / phone… (tip: press “/” to focus)"
              className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            />
          </Form>
        </SoTCard>

        <SoTCard className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-medium text-slate-700">
              {q ? <>Results for “{q}”</> : "All customers"}
            </div>
            <div className="text-[11px] text-slate-500">
              {list.length} item(s)
            </div>
          </div>

          {list.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">No matches.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.map((c) => {
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
                          to={`/customers/${c.id}${ctxSuffix}`}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                          title="Profile"
                        >
                          Profile
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SoTCard>

        <div className="mt-3 text-[11px] text-slate-500">
          Tips: press <kbd className="rounded border px-1">/</kbd> to focus
          search • use name, alias, or phone
        </div>
      </div>
    </main>
  );
}
