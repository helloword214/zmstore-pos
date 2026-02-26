/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
  Link,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { TextInput } from "~/components/ui/TextInput";
import { Button } from "~/components/ui/Button";
import { requireRole } from "~/utils/auth.server";

type ProvinceRow = {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
  usageCount: number;
};

type LoaderData = { provinces: ProvinceRow[] };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const provinces = await db.province.findMany({
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, code: true, isActive: true },
  });

  const counts = await db.customerAddress.groupBy({
    by: ["provinceId"],
    _count: { provinceId: true },
    where: { provinceId: { not: null } },
  });
  const byId = new Map<number, number>();
  counts.forEach((c) => {
    if (c.provinceId != null) byId.set(c.provinceId, c._count.provinceId);
  });

  const rows: ProvinceRow[] = provinces.map((p) => ({
    ...p,
    usageCount: byId.get(p.id) ?? 0,
  }));

  return json<LoaderData>({ provinces: rows });
}

export function ErrorBoundary() {
  const err = useRouteError();
  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-rose-700">Error</h1>
        <pre className="whitespace-pre-wrap text-sm bg-rose-50 border border-rose-200 rounded-md p-3">
          {isRouteErrorResponse(err)
            ? `${err.status} ${err.statusText}\n${JSON.stringify(err.data)}`
            : (err as Error)?.message ?? "Unknown error"}
        </pre>
        <Link to="/settings" className="inline-block underline text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1">
          ← Back to Settings
        </Link>
      </div>
    </main>
  );
}

type ActionData =
  | { ok: true; action: string; id?: number }
  | { ok: false; error: string; field?: string };

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  try {
    if (intent === "create") {
      const name = String(fd.get("name") || "").trim();
      const code =
        (fd.get("code") ? String(fd.get("code")) : null)?.trim() || null;
      if (name.length < 2) {
        return json<ActionData>(
          { ok: false, error: "Name too short.", field: "name" },
          { status: 400 }
        );
      }
      const dup = await db.province.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
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

    if (intent === "rename") {
      const id = Number(fd.get("id"));
      const name = String(fd.get("name") || "").trim();
      if (!Number.isFinite(id))
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      if (name.length < 2)
        return json<ActionData>(
          { ok: false, error: "Name too short.", field: "name" },
          { status: 400 }
        );

      const exists = await db.province.findFirst({
        where: { id: { not: id }, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (exists)
        return json<ActionData>(
          { ok: false, error: "Name already taken.", field: "name" },
          { status: 400 }
        );

      await db.province.update({ where: { id }, data: { name } });
      return json<ActionData>({ ok: true, action: "rename", id });
    }

    if (intent === "setCode") {
      const id = Number(fd.get("id"));
      const code =
        (fd.get("code") ? String(fd.get("code")) : "").trim() || null;
      if (!Number.isFinite(id))
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      await db.province.update({ where: { id }, data: { code } });
      return json<ActionData>({ ok: true, action: "setCode", id });
    }

    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      const val = String(fd.get("value") || "") === "true";
      if (!Number.isFinite(id))
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      await db.province.update({ where: { id }, data: { isActive: val } });
      return json<ActionData>({ ok: true, action: "toggle", id });
    }

    if (intent === "delete") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id))
        return json<ActionData>(
          { ok: false, error: "Invalid id." },
          { status: 400 }
        );
      const usage = await db.customerAddress.count({
        where: { provinceId: id },
      });
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

export default function ProvincesSettingsPage() {
  const { provinces } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const [creating, setCreating] = React.useState({ name: "", code: "" });
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editCodeId, setEditCodeId] = React.useState<number | null>(null);
  const [editCode, setEditCode] = React.useState("");

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            Settings — Provinces
          </h1>
          <Link to="/settings" className="text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1">
            ← Back
          </Link>
        </header>

        {/* Create card */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800 mb-3">
            Add Province
          </h2>
          <fetcher.Form
            method="post"
            className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
          >
            <input type="hidden" name="intent" value="create" />
            <div className="sm:col-span-7">
              <TextInput
                name="name"
                label="Name"
                placeholder="e.g. Pangasinan"
                value={creating.name}
                onChange={(e) =>
                  setCreating((p) => ({ ...p, name: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-3">
              <TextInput
                name="code"
                label="Code (optional)"
                placeholder="e.g. 0155"
                value={creating.code}
                onChange={(e) =>
                  setCreating((p) => ({ ...p, code: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" className="w-full">
                Add
              </Button>
            </div>
          </fetcher.Form>

          {fetcher.data && !fetcher.data.ok ? (
            <p className="mt-2 text-sm text-rose-700">{fetcher.data.error}</p>
          ) : null}
        </section>

        {/* List */}
        <section className="rounded-2xl border border-slate-200 bg-white p-0 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium text-slate-800">
            Provinces ({provinces.length})
          </div>

          <div className="divide-y divide-slate-200">
            {provinces.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">
                No provinces yet.
              </div>
            ) : (
              provinces.map((p) => {
                const isEditingName = editingId === p.id;
                const isEditingCode = editCodeId === p.id;
                return (
                  <div
                    key={p.id}
                    className="px-4 py-3 grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-5">
                      {isEditingName ? (
                        <fetcher.Form
                          method="post"
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="intent" value="rename" />
                          <input type="hidden" name="id" value={p.id} />
                          <TextInput
                            name="name"
                            label=" "
                            placeholder="Province name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <Button type="submit" variant="primary">
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </fetcher.Form>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-slate-900">
                            {p.name}
                          </div>
                          <button
                            className="text-xs text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            onClick={() => {
                              setEditingId(p.id);
                              setEditName(p.name);
                            }}
                          >
                            Rename
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="col-span-3">
                      {isEditingCode ? (
                        <fetcher.Form
                          method="post"
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="intent" value="setCode" />
                          <input type="hidden" name="id" value={p.id} />
                          <TextInput
                            name="code"
                            label=" "
                            placeholder="Code"
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value)}
                          />
                          <Button type="submit" variant="primary">
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setEditCodeId(null)}
                          >
                            Cancel
                          </Button>
                        </fetcher.Form>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-slate-600">Code:</span>
                          <span className="font-mono">{p.code ?? "—"}</span>
                          <button
                            className="text-xs text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            onClick={() => {
                              setEditCodeId(p.id);
                              setEditCode(p.code ?? "");
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="col-span-2 text-sm text-slate-600">
                      Used by:{" "}
                      <span className="font-medium">{p.usageCount}</span>
                    </div>

                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <input type="hidden" name="id" value={p.id} />
                        <input
                          type="hidden"
                          name="value"
                          value={String(!p.isActive)}
                        />
                        <Button
                          variant={p.isActive ? "ghost" : "primary"}
                          type="submit"
                        >
                          {p.isActive ? "Disable" : "Enable"}
                        </Button>
                      </fetcher.Form>

                      <fetcher.Form
                        method="post"
                        onSubmit={(e) => {
                          if (p.usageCount > 0) {
                            e.preventDefault();
                            alert(
                              `Cannot delete. Used by ${p.usageCount} address(es).`
                            );
                          } else if (!confirm(`Delete "${p.name}"?`)) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={p.id} />
                        <Button variant="ghost" disabled={p.usageCount > 0}>
                          Delete
                        </Button>
                      </fetcher.Form>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
