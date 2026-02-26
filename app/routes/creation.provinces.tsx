/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "@remix-run/react";
import * as React from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTSectionHeader } from "~/components/ui/SoTSectionHeader";
import {
  SoTTable,
  SoTTd,
  SoTTh,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
} from "~/components/ui/SoTTable";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

const PAGE_SIZE = 12;

type StatusFilter = "all" | "active" | "inactive";

type ProvinceRow = {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
  usageCount: number;
};

type ActionData =
  | { ok: true; action: string; id?: number }
  | { ok: false; error: string; field?: string };

function parseStatus(value: string | null): StatusFilter {
  if (value === "active" || value === "inactive") return value;
  return "all";
}

function parsePage(value: string | null) {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = parseStatus(url.searchParams.get("status"));
  const requestedPage = parsePage(url.searchParams.get("page"));

  const where: Record<string, unknown> = {};
  if (q) {
    where.name = { contains: q, mode: "insensitive" };
  }
  if (status === "active") where.isActive = true;
  if (status === "inactive") where.isActive = false;

  const total = await db.province.count({ where: where as any });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const provinces = await db.province.findMany({
    where: where as any,
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, code: true, isActive: true },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const provinceIds = provinces.map((p) => p.id);
  const counts = provinceIds.length
    ? await db.customerAddress.groupBy({
        by: ["provinceId"],
        _count: { provinceId: true },
        where: { provinceId: { in: provinceIds } },
      })
    : [];

  const byId = new Map<number, number>();
  counts.forEach((c) => {
    if (c.provinceId != null) byId.set(c.provinceId, c._count.provinceId);
  });

  const rows: ProvinceRow[] = provinces.map((p) => ({
    ...p,
    usageCount: byId.get(p.id) ?? 0,
  }));

  return json({
    provinces: rows,
    q,
    status,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  try {
    if (intent === "create") {
      const name = String(fd.get("name") || "").trim();
      const code = String(fd.get("code") || "").trim() || null;
      if (name.length < 2) {
        return json<ActionData>(
          { ok: false, error: "Name too short.", field: "name" },
          { status: 400 }
        );
      }
      const dup = await db.province.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (dup) {
        return json<ActionData>(
          { ok: false, error: "Province already exists.", field: "name" },
          { status: 400 }
        );
      }
      const created = await db.province.create({
        data: { name, code, isActive: true },
      });
      return json<ActionData>({ ok: true, action: "create", id: created.id });
    }

    if (intent === "update") {
      const id = Number(fd.get("id"));
      const name = String(fd.get("name") || "").trim();
      const code = String(fd.get("code") || "").trim() || null;

      if (!Number.isFinite(id)) {
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      }
      if (name.length < 2) {
        return json<ActionData>(
          { ok: false, error: "Name too short.", field: "name" },
          { status: 400 }
        );
      }

      const exists = await db.province.findFirst({
        where: {
          id: { not: id },
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (exists) {
        return json<ActionData>(
          { ok: false, error: "Name already taken.", field: "name" },
          { status: 400 }
        );
      }

      await db.province.update({
        where: { id },
        data: { name, code },
      });
      return json<ActionData>({ ok: true, action: "update", id });
    }

    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      const val = String(fd.get("value") || "") === "true";
      if (!Number.isFinite(id)) {
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      }
      await db.province.update({ where: { id }, data: { isActive: val } });
      return json<ActionData>({ ok: true, action: "toggle", id });
    }

    if (intent === "delete") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) {
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      }
      const usage = await db.customerAddress.count({ where: { provinceId: id } });
      if (usage > 0) {
        return json<ActionData>(
          { ok: false, error: `Cannot delete. Used by ${usage} address(es).` },
          { status: 400 }
        );
      }
      await db.province.delete({ where: { id } });
      return json<ActionData>({ ok: true, action: "delete", id });
    }

    return json<ActionData>(
      { ok: false, error: "Unknown intent." },
      { status: 400 }
    );
  } catch (e: any) {
    return json<ActionData>(
      { ok: false, error: e?.message || "Operation failed." },
      { status: 500 }
    );
  }
}

export function ErrorBoundary() {
  const err = useRouteError();
  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-rose-700">Error</h1>
        <pre className="whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-3 text-sm">
          {isRouteErrorResponse(err)
            ? `${err.status} ${err.statusText}\n${JSON.stringify(err.data)}`
            : (err as Error)?.message ?? "Unknown error"}
        </pre>
        <Link
          to="/"
          className="inline-block text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
        >
          {"<-"} Back to Dashboard
        </Link>
      </div>
    </main>
  );
}

export default function ProvincesCreationPage() {
  const { provinces, q, status, page, pageSize, total, totalPages } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = React.useState(false);
  const [creating, setCreating] = React.useState({ name: "", code: "" });

  const [editing, setEditing] = React.useState<ProvinceRow | null>(null);
  const [editForm, setEditForm] = React.useState({ name: "", code: "" });

  React.useEffect(() => {
    if (!editing) return;
    setEditForm({ name: editing.name, code: editing.code ?? "" });
  }, [editing]);

  function gotoPage(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    params.set("page", String(nextPage));
    navigate(`?${params.toString()}`);
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Creation - Provinces"
        subtitle="Scalable province master list for address choices."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <SoTCard interaction="static">
          <SoTActionBar
            left={
              <Form method="get" className="flex flex-wrap items-end gap-2">
                <SoTFormField label="Search">
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder="Search province"
                    className="h-9 w-56 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  />
                </SoTFormField>
                <SoTFormField label="Status">
                  <select
                    name="status"
                    defaultValue={status}
                    className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </SoTFormField>
                <SoTButton type="submit" className="h-9" variant="secondary">
                  Apply
                </SoTButton>
                <Link
                  to="/creation/provinces"
                  className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Reset
                </Link>
              </Form>
            }
            right={
              <SoTButton
                type="button"
                variant="primary"
                onClick={() => setShowCreate((v) => !v)}
              >
                {showCreate ? "Hide Add Form" : "Add Province"}
              </SoTButton>
            }
          />

          <SoTAlert tone="info">
            Showing {start}-{end} of {total} province entries.
          </SoTAlert>
        </SoTCard>

        {showCreate ? (
          <SoTCard interaction="form">
            <SoTSectionHeader title="Create Province" />
            <fetcher.Form method="post" className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input type="hidden" name="intent" value="create" />
              <div className="md:col-span-7">
                <SoTInput
                  name="name"
                  label="Name"
                  placeholder="e.g. Pangasinan"
                  value={creating.name}
                  onChange={(e) =>
                    setCreating((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-3">
                <SoTInput
                  name="code"
                  label="Code"
                  placeholder="Optional"
                  value={creating.code}
                  onChange={(e) =>
                    setCreating((prev) => ({ ...prev, code: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2 md:flex md:items-end">
                <SoTButton type="submit" variant="primary" className="w-full">
                  Save
                </SoTButton>
              </div>
            </fetcher.Form>
          </SoTCard>
        ) : null}

        {editing ? (
          <SoTCard interaction="form">
            <SoTSectionHeader title={`Edit Province #${editing.id}`} />
            <fetcher.Form method="post" className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={editing.id} />
              <div className="md:col-span-7">
                <SoTInput
                  name="name"
                  label="Name"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-3">
                <SoTInput
                  name="code"
                  label="Code"
                  value={editForm.code}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, code: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2 flex items-end gap-2">
                <SoTButton type="submit" variant="primary" className="w-full">
                  Update
                </SoTButton>
                <SoTButton
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </SoTButton>
              </div>
            </fetcher.Form>
          </SoTCard>
        ) : null}

        {fetcher.data && !fetcher.data.ok ? (
          <SoTAlert tone="danger">{fetcher.data.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="static" className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Province Directory
            </h2>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Name</SoTTh>
                <SoTTh>Code</SoTTh>
                <SoTTh>Usage</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Actions</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {provinces.length === 0 ? (
                <SoTTableEmptyRow colSpan={5} message="No provinces found." />
              ) : (
                provinces.map((p) => (
                  <SoTTableRow key={p.id}>
                    <SoTTd>
                      <div className="font-medium text-slate-900">{p.name}</div>
                    </SoTTd>
                    <SoTTd>
                      <span className="font-mono text-xs text-slate-700">{p.code ?? "-"}</span>
                    </SoTTd>
                    <SoTTd>{p.usageCount}</SoTTd>
                    <SoTTd>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.isActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {p.isActive ? "Active" : "Inactive"}
                      </span>
                    </SoTTd>
                    <SoTTd align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <SoTButton
                          type="button"
                          variant="secondary"
                          className="h-8 px-2 py-0 text-xs"
                          onClick={() => setEditing(p)}
                        >
                          Edit
                        </SoTButton>

                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="toggle" />
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="value" value={String(!p.isActive)} />
                          <SoTButton
                            type="submit"
                            variant="secondary"
                            className="h-8 px-2 py-0 text-xs"
                          >
                            {p.isActive ? "Disable" : "Enable"}
                          </SoTButton>
                        </fetcher.Form>

                        <fetcher.Form
                          method="post"
                          onSubmit={(e) => {
                            if (p.usageCount > 0) {
                              e.preventDefault();
                              return;
                            }
                            if (!confirm(`Delete "${p.name}"?`)) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={p.id} />
                          <SoTButton
                            type="submit"
                            variant="danger"
                            className="h-8 px-2 py-0 text-xs"
                            disabled={p.usageCount > 0}
                          >
                            Delete
                          </SoTButton>
                        </fetcher.Form>
                      </div>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <SoTButton
                type="button"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => gotoPage(page - 1)}
                className="h-8 px-2 py-0 text-xs"
              >
                Previous
              </SoTButton>
              <SoTButton
                type="button"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => gotoPage(page + 1)}
                className="h-8 px-2 py-0 text-xs"
              >
                Next
              </SoTButton>
            </div>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
