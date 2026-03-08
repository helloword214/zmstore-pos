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
import { SelectInput } from "~/components/ui/SelectInput";
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
  const showArchived = url.searchParams.get("showArchived") === "1";

  const [categories, units, packingUnits, locations] = await Promise.all([
    db.category.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.packingUnit.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { name: "asc" } }),
  ]);

  const visibleCategories = showArchived
    ? categories
    : categories.filter((category) => category.isActive);

  const requestedCategoryId =
    catParam && Number.isFinite(Number(catParam)) ? Number(catParam) : null;

  const activeCategoryId =
    requestedCategoryId &&
    visibleCategories.some((category) => category.id === requestedCategoryId)
      ? requestedCategoryId
      : visibleCategories[0]?.id ?? null;

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
    visibleCategories,
    showArchived,
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
  | "category"
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
    visibleCategories,
    showArchived,
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
  const [newCategoryName, setNewCategoryName] = React.useState("");

  React.useEffect(() => {
    if (!fetcher.data?.message) return;
    setMessage(fetcher.data.message);
    setMessageTone(fetcher.data.ok ? "success" : "warning");
  }, [fetcher.data]);

  function setCategory(id: number) {
    if (!Number.isFinite(id) || id <= 0) return;
    if (!visibleCategories.some((category) => category.id === id)) return;
    const next = new URLSearchParams(sp);
    next.set("cat", String(id));
    setSp(next, { replace: true });
  }

  function setShowArchived(nextShowArchived: boolean) {
    const next = new URLSearchParams(sp);
    if (nextShowArchived) {
      next.set("showArchived", "1");
    } else {
      next.delete("showArchived");
    }
    setSp(next, { replace: true });
  }

  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ?? null;
  const activeCategoryName = activeCategory?.name ?? "Not selected";
  const activeCategoryArchived = Boolean(activeCategory && !activeCategory.isActive);

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
            Manage global options on the left. On the right, manage category lifecycle (active or archived), then edit one category option type at a time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SoTStatusPill tone="info">Global: Units / Packing / Locations</SoTStatusPill>
            <SoTStatusPill tone="info">Category lifecycle: Create / Rename / Archive</SoTStatusPill>
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
                    size="compact"
                    onClick={() => setGlobalTab("units")}
                  >
                    Units
                  </SoTButton>
                  <SoTButton
                    type="button"
                    variant={globalTab === "packingUnits" ? "primary" : "secondary"}
                    size="compact"
                    onClick={() => setGlobalTab("packingUnits")}
                  >
                    Packing Units
                  </SoTButton>
                  <SoTButton
                    type="button"
                    variant={globalTab === "locations" ? "primary" : "secondary"}
                    size="compact"
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
                <SoTCard interaction="form" className="border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">Category Master</p>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(event) => setShowArchived(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      Show archived
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
                    <div className="md:col-span-9">
                      <SoTInput
                        label="Add Category"
                        value={newCategoryName}
                        placeholder="e.g. Grocery"
                        onChange={(event) => setNewCategoryName(event.target.value)}
                      />
                    </div>
                    <div className="md:col-span-3 md:flex md:items-end">
                      <SoTButton
                        type="button"
                        className="h-10 w-full"
                        onClick={() => {
                          const name = newCategoryName.trim();
                          if (!name) return;
                          fetcher.submit(
                            { kind: "category", name },
                            { method: "post", action: "/resources/creation/upsert" }
                          );
                          setNewCategoryName("");
                        }}
                      >
                        Add Category
                      </SoTButton>
                    </div>
                  </div>

                  <div className="mt-3 max-h-[260px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                    <SoTTable>
                      <SoTTableHead>
                        <SoTTableRow>
                          <SoTTh>Category</SoTTh>
                          <SoTTh align="center">Status</SoTTh>
                          <SoTTh align="right">Action</SoTTh>
                        </SoTTableRow>
                      </SoTTableHead>
                      <tbody>
                        {visibleCategories.length === 0 ? (
                          <SoTTableEmptyRow
                            colSpan={3}
                            message="No categories available for current filter."
                          />
                        ) : (
                          visibleCategories.map((category) => (
                            <SoTTableRow key={category.id}>
                              <SoTTd className="font-medium text-slate-900">
                                {category.name}
                              </SoTTd>
                              <SoTTd align="center">
                                <SoTStatusPill tone={category.isActive ? "success" : "warning"}>
                                  {category.isActive ? "Active" : "Archived"}
                                </SoTStatusPill>
                              </SoTTd>
                              <SoTTd align="right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <SoTButton
                                    type="button"
                                    variant="secondary"
                                    size="compact"
                                    onClick={() => setCategory(category.id)}
                                  >
                                    Use
                                  </SoTButton>
                                  <SoTButton
                                    type="button"
                                    variant="secondary"
                                    size="compact"
                                    onClick={() => {
                                      const edited = window.prompt(
                                        "Rename category",
                                        category.name
                                      );
                                      const nextName = (edited ?? "").trim();
                                      if (!nextName || nextName === category.name) return;
                                      fetcher.submit(
                                        {
                                          intent: "update",
                                          kind: "category",
                                          id: category.id,
                                          name: nextName,
                                        },
                                        {
                                          method: "post",
                                          action: "/resources/creation/upsert",
                                        }
                                      );
                                    }}
                                  >
                                    Rename
                                  </SoTButton>
                                  <SoTButton
                                    type="button"
                                    variant={category.isActive ? "danger" : "primary"}
                                    size="compact"
                                    onClick={() => {
                                      if (
                                        !window.confirm(
                                          category.isActive
                                            ? `Archive "${category.name}"? It will be hidden from product form choices.`
                                            : `Unarchive "${category.name}" and make it available again?`
                                        )
                                      ) {
                                        return;
                                      }
                                      fetcher.submit(
                                        {
                                          intent: category.isActive
                                            ? "archive"
                                            : "unarchive",
                                          kind: "category",
                                          id: category.id,
                                        },
                                        {
                                          method: "post",
                                          action: "/resources/creation/upsert",
                                        }
                                      );
                                    }}
                                  >
                                    {category.isActive ? "Archive" : "Unarchive"}
                                  </SoTButton>
                                </div>
                              </SoTTd>
                            </SoTTableRow>
                          ))
                        )}
                      </tbody>
                    </SoTTable>
                  </div>
                </SoTCard>

                <SoTFormField label="Category Context">
                  <SelectInput
                    value={activeCategoryId ?? ""}
                    onChange={(value) => setCategory(Number(value))}
                    options={visibleCategories.map((category) => ({
                      label: category.isActive
                        ? category.name
                        : `${category.name} (Archived)`,
                      value: category.id,
                    }))}
                  />
                </SoTFormField>

                <SoTCard interaction="static" className="border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Active Category
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{activeCategoryName}</p>
                    {activeCategory ? (
                      <SoTStatusPill tone={activeCategory.isActive ? "success" : "warning"}>
                        {activeCategory.isActive ? "Active" : "Archived"}
                      </SoTStatusPill>
                    ) : null}
                  </div>
                </SoTCard>

                {activeCategoryArchived ? (
                  <SoTAlert tone="warning">
                    Selected category is archived. Unarchive it first to add, edit, or delete
                    brand/indication/target options.
                  </SoTAlert>
                ) : null}

                {!activeCategoryId ? (
                  <SoTAlert tone="info">Select a category to manage category options.</SoTAlert>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <SoTButton
                        type="button"
                        variant={categoryTab === "brands" ? "primary" : "secondary"}
                        size="compact"
                        onClick={() => setCategoryTab("brands")}
                      >
                        Brands
                      </SoTButton>
                      <SoTButton
                        type="button"
                        variant={categoryTab === "indications" ? "primary" : "secondary"}
                        size="compact"
                        onClick={() => setCategoryTab("indications")}
                      >
                        Indications
                      </SoTButton>
                      <SoTButton
                        type="button"
                        variant={categoryTab === "targets" ? "primary" : "secondary"}
                        size="compact"
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
                        disabled={activeCategoryArchived}
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
                        disabled={activeCategoryArchived}
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
                        disabled={activeCategoryArchived}
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
  disabled?: boolean;
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
            disabled={props.disabled}
          />
        </div>

        <div className="md:col-span-5">
          <SoTInput
            label="Add Option"
            value={newName}
            placeholder={props.addPlaceholder}
            onChange={(e) => setNewName(e.target.value)}
            disabled={props.disabled}
          />
        </div>

        <div className="md:col-span-2 md:flex md:items-end">
          <SoTButton
            type="button"
            className="h-10 w-full"
            disabled={props.disabled}
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
                disabled={props.disabled}
              />
            </div>
            <div className="md:col-span-4 flex items-end gap-2">
              <SoTButton
                type="button"
                className="w-full"
                disabled={props.disabled}
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
                disabled={props.disabled}
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
                        size="compact"
                        disabled={props.disabled}
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
                        size="compact"
                        disabled={props.disabled}
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
