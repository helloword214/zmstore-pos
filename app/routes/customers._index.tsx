// app/routes/customers._index.tsx
import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useFetcher, useLoaderData, useSubmit } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import {
  SoTTable,
  SoTTd,
  SoTTh,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
} from "~/components/ui/SoTTable";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

type CustomerRow = {
  id: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  alias: string | null;
  phone: string | null;
};

// ----- Types used by the component (no `typeof loader` needed)
type LoaderData = {
  rows: CustomerRow[];
  q: string;
  ctx: "admin";
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const ctx = "admin";

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
        AND: tokens.map<Prisma.CustomerWhereInput>((token) => ({
          OR: [
            { firstName: { contains: token, mode: "insensitive" } },
            { middleName: { contains: token, mode: "insensitive" } },
            { lastName: { contains: token, mode: "insensitive" } },
            { alias: { contains: token, mode: "insensitive" } },
            { phone: { contains: token, mode: "insensitive" } },
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
  const { rows, q } = useLoaderData<LoaderData>();
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const debounceRef = React.useRef<number | null>(null);
  const submit = useSubmit();
  const searchFx = useFetcher<{ hits: CustomerRow[] }>();

  const [query, setQuery] = React.useState(q);

  const ctxSuffix = "?ctx=admin";
  const clearDebounce = React.useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  React.useEffect(() => clearDebounce, [clearDebounce]);

  // Keyboard shortcut: press "/" outside inputs to focus search.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      (
        searchRef.current ??
        document.querySelector<HTMLInputElement>('input[name="q"]')
      )?.focus();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Initial live search when route lands with ?q=
  React.useEffect(() => {
    if (!q) return;
    searchFx.load(`/api/customers/search?q=${encodeURIComponent(q)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveHits = searchFx.data?.hits ?? null;
  const list = (liveHits && query.trim() ? liveHits : rows) as CustomerRow[];
  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Customers"
        subtitle="Browse and maintain customer records for profile and pricing workflows."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <SoTCard interaction="form">
          <SoTActionBar
            left={
              <Form
                method="get"
                ref={formRef}
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  clearDebounce();
                  submit(formRef.current!, { method: "get", replace: true });
                }}
              >
                <input type="hidden" name="ctx" value="admin" />
                <SoTFormField label="Search" className="w-full sm:w-auto">
                  <input
                    ref={searchRef}
                    name="q"
                    type="search"
                    value={query}
                    onChange={(e) => {
                      const value = e.target.value;
                      setQuery(value);

                      clearDebounce();
                      debounceRef.current = window.setTimeout(() => {
                        debounceRef.current = null;
                        if (value.trim()) {
                          searchFx.load(
                            `/api/customers/search?q=${encodeURIComponent(value.trim())}`
                          );
                        }
                      }, 250);
                    }}
                    placeholder="Search name / alias / phone"
                    className="h-9 w-72 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  />
                </SoTFormField>

                <SoTButton type="submit" variant="secondary" className="h-9">
                  Apply
                </SoTButton>

                <Link
                  to={`/customers${ctxSuffix}`}
                  onMouseDown={clearDebounce}
                  className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Reset
                </Link>
              </Form>
            }
            right={
              <Link
                to={`/customers/new${ctxSuffix}`}
                onMouseDown={clearDebounce}
                className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                New Customer
              </Link>
            }
          />

          <SoTAlert tone="info">
            Tip: press <kbd className="rounded border px-1">/</kbd> to focus search.
          </SoTAlert>
        </SoTCard>

        <SoTCard interaction="static" className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Customer Directory
            </h2>
            <span className="text-xs text-slate-500">
              {query.trim() ? `Results for "${query.trim()}"` : "All customers"}
            </span>
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            <SoTTable>
              <SoTTableHead>
                <SoTTableRow>
                  <SoTTh>Customer</SoTTh>
                  <SoTTh>Phone</SoTTh>
                  <SoTTh align="right">Action</SoTTh>
                </SoTTableRow>
              </SoTTableHead>
              <tbody>
                {list.length === 0 ? (
                  <SoTTableEmptyRow colSpan={3} message="No customer records found." />
                ) : (
                  list.map((customer) => {
                    const fullName = [
                      customer.firstName,
                      customer.middleName,
                      customer.lastName,
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <SoTTableRow key={customer.id}>
                        <SoTTd>
                          <p className="font-medium text-slate-900">{fullName}</p>
                          <p className="text-xs text-slate-500">
                            {customer.alias ? `Alias: ${customer.alias}` : "No alias"}
                          </p>
                        </SoTTd>
                        <SoTTd>
                          <span className="text-sm text-slate-700">{customer.phone ?? "-"}</span>
                        </SoTTd>
                        <SoTTd align="right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link
                              to={`/customers/${customer.id}${ctxSuffix}`}
                              onMouseDown={clearDebounce}
                              className="inline-flex h-8 items-center rounded-xl border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            >
                              View Profile
                            </Link>
                          </div>
                        </SoTTd>
                      </SoTTableRow>
                    );
                  })
                )}
              </tbody>
            </SoTTable>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
