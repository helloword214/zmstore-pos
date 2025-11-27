import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useFetcher,
  useLoaderData,
  useSearchParams,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
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

export default function SettingsIndex() {
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
  const fetcher = useFetcher<{ ok?: boolean; message?: string }>();
  const [msg, setMsg] = React.useState<string | null>(null);
  const catSelectId = React.useId();
  React.useEffect(() => {
    if (fetcher.data && "message" in fetcher.data && fetcher.data.message) {
      setMsg(fetcher.data.message);
    }
  }, [fetcher.data]);

  function setCat(id: number) {
    sp.set("cat", String(id));
    setSp(sp, { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            Settings · Master Data
          </h1>
          <Link to="/" className="text-sm underline">
            ← Back
          </Link>
        </header>

        {msg ? (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm">
            {msg}
          </div>
        ) : null}

        {/* Quick nav */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <NavCard title="Geo Master">
            <NavLink to="/settings/provinces" label="Provinces" />
            <NavLink
              to="/settings/areas"
              label="Areas (Municipality · Barangay · Zone · Landmark)"
            />
          </NavCard>
          <NavCard title="Fleet">
            <NavLink to="/settings/vehicles" label="Vehicles" />
            <NavLink to="/settings/riders" label="Riders" />
          </NavCard>
          <NavCard title="Catalog Globals">
            <span className="text-xs text-slate-500">Manage below</span>
          </NavCard>
          <NavCard title="Per-Category">
            <span className="text-xs text-slate-500">
              Brands, Indications, Targets
            </span>
          </NavCard>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* GLOBAL: Units & Packing Units */}
          <Card title="Units">
            <Adder
              placeholder="New unit (e.g. kg)"
              onAdd={(name) =>
                fetcher.submit(
                  { kind: "unit", name },
                  { method: "post", action: "/resources/settings/upsert" }
                )
              }
            />
            <List
              rows={units}
              onDelete={(id) =>
                fetcher.submit(
                  { kind: "unit", id },
                  { method: "post", action: "/resources/settings/delete" }
                )
              }
            />
            <div className="h-4" />
            <h3 className="font-medium mb-2">Packing Units</h3>
            <Adder
              placeholder="New packing unit (e.g. sack)"
              onAdd={(name) =>
                fetcher.submit(
                  { kind: "packingUnit", name },
                  { method: "post", action: "/resources/settings/upsert" }
                )
              }
            />
            <List
              rows={packingUnits}
              onDelete={(id) =>
                fetcher.submit(
                  { kind: "packingUnit", id },
                  { method: "post", action: "/resources/settings/delete" }
                )
              }
            />
          </Card>

          {/* GLOBAL: Locations */}
          <Card title="Locations">
            <Adder
              placeholder="New location (e.g. Feeds Section)"
              onAdd={(name) =>
                fetcher.submit(
                  { kind: "location", name },
                  { method: "post", action: "/resources/settings/upsert" }
                )
              }
            />
            <List
              rows={locations}
              onDelete={(id) =>
                fetcher.submit(
                  { kind: "location", id },
                  { method: "post", action: "/resources/settings/delete" }
                )
              }
            />
          </Card>

          {/* PER-CATEGORY: Brands / Indications / Targets */}
          <Card title="Per-Category">
            <div className="mb-3">
              <label htmlFor={catSelectId} className="text-sm">
                Category
              </label>
              <select
                id={catSelectId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={activeCategoryId ?? ""}
                onChange={(e) => setCat(Number(e.target.value))}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <Section
              title="Brands"
              addPlaceholder="New brand"
              rows={brands}
              onAdd={(name) =>
                fetcher.submit(
                  {
                    kind: "brand",
                    name,
                    categoryId: String(activeCategoryId ?? ""),
                  },
                  { method: "post", action: "/resources/settings/upsert" }
                )
              }
              onDelete={(id) =>
                fetcher.submit(
                  {
                    kind: "brand",
                    id,
                    categoryId: String(activeCategoryId ?? ""),
                  },
                  { method: "post", action: "/resources/settings/delete" }
                )
              }
            />

            <Section
              title="Indications"
              addPlaceholder="New indication"
              rows={indications}
              onAdd={(name) =>
                fetcher.submit(
                  {
                    kind: "indication",
                    name,
                    categoryId: String(activeCategoryId ?? ""),
                  },
                  { method: "post", action: "/resources/settings/upsert" }
                )
              }
              onDelete={(id) =>
                fetcher.submit(
                  {
                    kind: "indication",
                    id,
                    categoryId: String(activeCategoryId ?? ""),
                  },
                  { method: "post", action: "/resources/settings/delete" }
                )
              }
            />

            <Section
              title="Targets"
              addPlaceholder="New target"
              rows={targets}
              onAdd={(name) =>
                fetcher.submit(
                  {
                    kind: "target",
                    name,
                    categoryId: String(activeCategoryId ?? ""),
                  },
                  { method: "post", action: "/resources/settings/upsert" }
                )
              }
              onDelete={(id) =>
                fetcher.submit(
                  {
                    kind: "target",
                    id,
                    categoryId: String(activeCategoryId ?? ""),
                  },
                  { method: "post", action: "/resources/settings/delete" }
                )
              }
            />
          </Card>
        </div>
      </div>
    </main>
  );
}

function NavCard(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold mb-3">{props.title}</h2>
      <div className="grid gap-2">{props.children}</div>
    </section>
  );
}
function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
    >
      {label}
    </Link>
  );
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4 shadow-sm bg-white">
      <h2 className="text-base font-semibold mb-3">{props.title}</h2>
      {props.children}
    </section>
  );
}

function Adder(props: { placeholder: string; onAdd: (name: string) => void }) {
  const [name, setName] = React.useState("");
  return (
    <div className="flex gap-2 mb-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={props.placeholder}
        className="flex-1 border rounded-md px-2 py-1"
      />
      <button
        type="button"
        onClick={() => {
          const n = name.trim();
          if (!n) return;
          props.onAdd(n);
          setName("");
        }}
        className="border rounded-md px-3"
      >
        Add
      </button>
    </div>
  );
}

function List(props: { rows: SimpleRow[]; onDelete: (id: number) => void }) {
  return (
    <ul className="divide-y border rounded-md">
      {props.rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between px-2 py-1">
          <span>{r.name}</span>
          <button
            type="button"
            onClick={() => props.onDelete(r.id)}
            className="text-red-600 text-sm"
            aria-label={`Delete ${r.name}`}
            title="Delete"
          >
            Delete
          </button>
        </li>
      ))}
      {props.rows.length === 0 ? (
        <li className="px-2 py-2 text-sm text-gray-500">No items</li>
      ) : null}
    </ul>
  );
}

function Section(props: {
  title: string;
  addPlaceholder: string;
  rows: SimpleRow[];
  onAdd: (name: string) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="mb-5">
      <h3 className="font-medium mb-2">{props.title}</h3>
      <Adder placeholder={props.addPlaceholder} onAdd={props.onAdd} />
      <List rows={props.rows} onDelete={props.onDelete} />
    </div>
  );
}
