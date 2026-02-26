import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import * as React from "react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEntityFormPanel } from "~/components/ui/SoTEntityFormPanel";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusPill } from "~/components/ui/SoTStatusPill";
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

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const catParam = url.searchParams.get("cat");

  const [categories, units, packingUnits, locations] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.packingUnit.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { name: "asc" } }),
  ]);

  const activeCategoryId =
    catParam && Number.isFinite(Number(catParam))
      ? Number(catParam)
      : categories[0]?.id ?? null;

  const [brands, indications, targets] = activeCategoryId
    ? await Promise.all([
        db.brand.findMany({
          where: { categoryId: activeCategoryId },
          orderBy: { name: "asc" },
        }),
        db.indication.findMany({
          where: { categoryId: activeCategoryId },
          orderBy: { name: "asc" },
        }),
        db.target.findMany({
          where: { categoryId: activeCategoryId },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], [], []];

  return json({
    categories,
    units,
    packingUnits,
    locations,
    activeCategoryId,
    brands,
    indications,
    targets,
  });
}

type SimpleRow = { id: number; name: string };

type UpsertDeleteFetcherData = {
  ok?: boolean;
  message?: string;
};

type Kind =
  | "unit"
  | "packingUnit"
  | "location"
  | "brand"
  | "indication"
  | "target";

type CategoryTab = "brands" | "indications" | "targets";
type GlobalTab = "units" | "packingUnits" | "locations";

export default function CreationIndex() {
  const {
    categories,
    units,
    packingUnits,
    locations,
    activeCategoryId,
    brands,
    indications,
    targets,
  } = useLoaderData<typeof loader>();

  const [sp, setSp] = useSearchParams();
  const fetcher = useFetcher<UpsertDeleteFetcherData>();
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageTone, setMessageTone] = React.useState<"success" | "warning">("warning");
  const [categoryTab, setCategoryTab] = React.useState<CategoryTab>("brands");
  const [globalTab, setGlobalTab] = React.useState<GlobalTab>("units");
  const catSelectId = React.useId();

  React.useEffect(() => {
    if (!fetcher.data?.message) return;
    setMessage(fetcher.data.message);
    setMessageTone(fetcher.data.ok ? "success" : "warning");
  }, [fetcher.data]);

  function setCategory(id: number) {
    const next = new URLSearchParams(sp);
    next.set("cat", String(id));
    setSp(next, { replace: true });
  }

  const activeCategoryName =
    categories.find((category) => category.id === activeCategoryId)?.name ?? "Not selected";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Product Option Library"
        subtitle="Admin-managed option source for product encoding choices."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {message ? (
          <SoTAlert tone={messageTone === "success" ? "success" : "warning"}>
            {message}
          </SoTAlert>
        ) : null}

        <SoTCard interaction="static">
          <p className="text-sm font-semibold text-slate-900">How to use this page</p>
          <p className="mt-1 text-xs text-slate-600">
            Manage global options on the left. On the right, choose one category and edit one option type at a time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SoTStatusPill tone="info">Global: Units / Packing / Locations</SoTStatusPill>
            <SoTStatusPill tone="info">Category: Brands / Indications / Targets</SoTStatusPill>
          </div>
        </SoTCard>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-stretch">
          <aside className="lg:col-span-5">
            <SoTEntityFormPanel title="Global Product Options">
              <div className="flex h-full min-h-0 flex-col space-y-4">
                <div className="flex flex-wrap gap-2">
                  <SoTButton
                    type="button"
                    variant={globalTab === "units" ? "primary" : "secondary"}
                    className="h-8 px-2 py-0 text-xs"
                    onClick={() => setGlobalTab("units")}
                  >
                    Units
                  </SoTButton>
                  <SoTButton
                    type="button"
                    variant={globalTab === "packingUnits" ? "primary" : "secondary"}
                    className="h-8 px-2 py-0 text-xs"
                    onClick={() => setGlobalTab("packingUnits")}
                  >
                    Packing Units
                  </SoTButton>
                  <SoTButton
                    type="button"
                    variant={globalTab === "locations" ? "primary" : "secondary"}
                    className="h-8 px-2 py-0 text-xs"
                    onClick={() => setGlobalTab("locations")}
                  >
                    Locations
                  </SoTButton>
                </div>

                {globalTab === "units" ? (
                  <CompactOptionSection
                    fillHeight
                    title="Units"
                    kind="unit"
                    rows={units}
                    addPlaceholder="e.g. kg"
                    emptyMessage="No units found."
                    onAdd={(name) =>
                      fetcher.submit(
                        { kind: "unit", name },
                        { method: "post", action: "/resources/creation/upsert" }
                      )
                    }
                    onDelete={(id) =>
                      fetcher.submit(
                        { kind: "unit", id },
                        { method: "post", action: "/resources/creation/delete" }
                      )
                    }
                    onUpdate={(id, name) =>
                      fetcher.submit(
                        { intent: "update", kind: "unit", id, name },
                        { method: "post", action: "/resources/creation/upsert" }
                      )
                    }
                  />
                ) : null}

                {globalTab === "packingUnits" ? (
                  <CompactOptionSection
                    fillHeight
                    title="Packing Units"
                    kind="packingUnit"
                    rows={packingUnits}
                    addPlaceholder="e.g. sack"
                    emptyMessage="No packing units found."
                    onAdd={(name) =>
                      fetcher.submit(
                        { kind: "packingUnit", name },
                        { method: "post", action: "/resources/creation/upsert" }
                      )
                    }
                    onDelete={(id) =>
                      fetcher.submit(
                        { kind: "packingUnit", id },
                        { method: "post", action: "/resources/creation/delete" }
                      )
                    }
                    onUpdate={(id, name) =>
                      fetcher.submit(
                        { intent: "update", kind: "packingUnit", id, name },
                        { method: "post", action: "/resources/creation/upsert" }
                      )
                    }
                  />
                ) : null}

                {globalTab === "locations" ? (
                  <CompactOptionSection
                    fillHeight
                    title="Locations"
                    kind="location"
                    rows={locations}
                    addPlaceholder="e.g. Feeds Section"
                    emptyMessage="No locations found."
                    onAdd={(name) =>
                      fetcher.submit(
                        { kind: "location", name },
                        { method: "post", action: "/resources/creation/upsert" }
                      )
                    }
                    onDelete={(id) =>
                      fetcher.submit(
                        { kind: "location", id },
                        { method: "post", action: "/resources/creation/delete" }
                      )
                    }
                    onUpdate={(id, name) =>
                      fetcher.submit(
                        { intent: "update", kind: "location", id, name },
                        { method: "post", action: "/resources/creation/upsert" }
                      )
                    }
                  />
                ) : null}
              </div>
            </SoTEntityFormPanel>
          </aside>

          <section className="lg:col-span-7">
            <SoTEntityFormPanel title="Category Option Workspace">
              <div className="space-y-4">
                <SoTFormField label="Category Context">
                  <select
                    id={catSelectId}
                    className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    value={activeCategoryId ?? ""}
                    onChange={(e) => setCategory(Number(e.target.value))}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </SoTFormField>

                <SoTCard interaction="static" className="border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Active Category
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{activeCategoryName}</p>
                </SoTCard>

                {!activeCategoryId ? (
                  <SoTAlert tone="info">Select a category to manage category options.</SoTAlert>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <SoTButton
                        type="button"
                        variant={categoryTab === "brands" ? "primary" : "secondary"}
                        className="h-8 px-2 py-0 text-xs"
                        onClick={() => setCategoryTab("brands")}
                      >
                        Brands
                      </SoTButton>
                      <SoTButton
                        type="button"
                        variant={categoryTab === "indications" ? "primary" : "secondary"}
                        className="h-8 px-2 py-0 text-xs"
                        onClick={() => setCategoryTab("indications")}
                      >
                        Indications
                      </SoTButton>
                      <SoTButton
                        type="button"
                        variant={categoryTab === "targets" ? "primary" : "secondary"}
                        className="h-8 px-2 py-0 text-xs"
                        onClick={() => setCategoryTab("targets")}
                      >
                        Targets
                      </SoTButton>
                    </div>

                    {categoryTab === "brands" ? (
                      <CompactOptionSection
                        title="Brands"
                        kind="brand"
                        rows={brands}
                        addPlaceholder="e.g. Del Monte"
                        emptyMessage="No brands found for selected category."
                        categoryId={activeCategoryId}
                        onAdd={(name) =>
                          fetcher.submit(
                            {
                              kind: "brand",
                              name,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/upsert" }
                          )
                        }
                        onDelete={(id) =>
                          fetcher.submit(
                            {
                              kind: "brand",
                              id,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/delete" }
                          )
                        }
                        onUpdate={(id, name) =>
                          fetcher.submit(
                            {
                              intent: "update",
                              kind: "brand",
                              id,
                              name,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/upsert" }
                          )
                        }
                      />
                    ) : null}

                    {categoryTab === "indications" ? (
                      <CompactOptionSection
                        title="Indications"
                        kind="indication"
                        rows={indications}
                        addPlaceholder="e.g. Fattening"
                        emptyMessage="No indications found for selected category."
                        categoryId={activeCategoryId}
                        onAdd={(name) =>
                          fetcher.submit(
                            {
                              kind: "indication",
                              name,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/upsert" }
                          )
                        }
                        onDelete={(id) =>
                          fetcher.submit(
                            {
                              kind: "indication",
                              id,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/delete" }
                          )
                        }
                        onUpdate={(id, name) =>
                          fetcher.submit(
                            {
                              intent: "update",
                              kind: "indication",
                              id,
                              name,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/upsert" }
                          )
                        }
                      />
                    ) : null}

                    {categoryTab === "targets" ? (
                      <CompactOptionSection
                        title="Targets"
                        kind="target"
                        rows={targets}
                        addPlaceholder="e.g. Broiler"
                        emptyMessage="No targets found for selected category."
                        categoryId={activeCategoryId}
                        onAdd={(name) =>
                          fetcher.submit(
                            {
                              kind: "target",
                              name,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/upsert" }
                          )
                        }
                        onDelete={(id) =>
                          fetcher.submit(
                            {
                              kind: "target",
                              id,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/delete" }
                          )
                        }
                        onUpdate={(id, name) =>
                          fetcher.submit(
                            {
                              intent: "update",
                              kind: "target",
                              id,
                              name,
                              categoryId: String(activeCategoryId),
                            },
                            { method: "post", action: "/resources/creation/upsert" }
                          )
                        }
                      />
                    ) : null}
                  </>
                )}
              </div>
            </SoTEntityFormPanel>
          </section>
        </div>
      </div>
    </main>
  );
}

function CompactOptionSection(props: {
  fillHeight?: boolean;
  title: string;
  kind: Kind;
  rows: SimpleRow[];
  addPlaceholder: string;
  emptyMessage: string;
  categoryId?: number | null;
  onAdd: (name: string) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, name: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editingName, setEditingName] = React.useState("");

  const filteredRows = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return props.rows;
    return props.rows.filter((row) => row.name.toLowerCase().includes(keyword));
  }, [props.rows, search]);

  React.useEffect(() => {
    if (editingId == null) return;
    const stillExists = props.rows.some((row) => row.id === editingId);
    if (!stillExists) {
      setEditingId(null);
      setEditingName("");
    }
  }, [props.rows, editingId]);

  return (
    <section
      className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${
        props.fillHeight
          ? "flex h-full min-h-0 flex-1 flex-col space-y-3"
          : "space-y-3"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{props.title}</h3>
        <SoTStatusPill tone="info">{props.rows.length} total</SoTStatusPill>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
        <div className="md:col-span-5">
          <SoTInput
            label="Search"
            value={search}
            placeholder={`Search ${props.title.toLowerCase()}`}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="md:col-span-5">
          <SoTInput
            label="Add Option"
            value={newName}
            placeholder={props.addPlaceholder}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>

        <div className="md:col-span-2 md:flex md:items-end">
          <SoTButton
            type="button"
            className="h-10 w-full"
            onClick={() => {
              const value = newName.trim();
              if (!value) return;
              props.onAdd(value);
              setNewName("");
            }}
          >
            Add
          </SoTButton>
        </div>
      </div>

      {editingId != null ? (
        <SoTCard interaction="form" className="border border-indigo-200 bg-indigo-50/60 p-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="md:col-span-8">
              <SoTInput
                label={`Edit ${props.title.slice(0, -1) || props.title}`}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
              />
            </div>
            <div className="md:col-span-4 flex items-end gap-2">
              <SoTButton
                type="button"
                className="w-full"
                onClick={() => {
                  const value = editingName.trim();
                  if (!value || editingId == null) return;
                  props.onUpdate(editingId, value);
                  setEditingId(null);
                  setEditingName("");
                }}
              >
                Save
              </SoTButton>
              <SoTButton
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setEditingId(null);
                  setEditingName("");
                }}
              >
                Cancel
              </SoTButton>
            </div>
          </div>
        </SoTCard>
      ) : null}

      <div
        className={`rounded-xl border border-slate-200 bg-white overflow-y-auto ${
          props.fillHeight ? "h-full min-h-0" : "max-h-[320px]"
        }`}
      >
        <SoTTable>
          <SoTTableHead>
            <SoTTableRow>
              <SoTTh>Name</SoTTh>
              <SoTTh align="right">Action</SoTTh>
            </SoTTableRow>
          </SoTTableHead>
          <tbody>
            {filteredRows.length === 0 ? (
              <SoTTableEmptyRow colSpan={2} message={props.emptyMessage} />
            ) : (
              filteredRows.map((row) => (
                <SoTTableRow key={row.id}>
                  <SoTTd>
                    <span className="font-medium text-slate-900">{row.name}</span>
                  </SoTTd>
                  <SoTTd align="right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <SoTButton
                        type="button"
                        variant="secondary"
                        className="h-8 px-2 py-0 text-xs"
                        onClick={() => {
                          setEditingId(row.id);
                          setEditingName(row.name);
                        }}
                      >
                        Edit
                      </SoTButton>

                      <SoTButton
                        type="button"
                        variant="danger"
                        className="h-8 px-2 py-0 text-xs"
                        onClick={() => {
                          if (!confirm(`Delete "${row.name}"?`)) return;
                          props.onDelete(row.id);
                        }}
                      >
                        Delete
                      </SoTButton>
                    </div>
                  </SoTTd>
                </SoTTableRow>
              ))
            )}
          </tbody>
        </SoTTable>
      </div>
    </section>
  );
}
