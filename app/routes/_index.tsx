import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link } from "@remix-run/react";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTRoleShellHeader } from "~/components/ui/SoTRoleShellHeader";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  return null;
}

type AdminShortcut = {
  to: string;
  title: string;
  description: string;
  eyebrow?: string;
  tone: "indigo" | "emerald" | "amber" | "sky" | "rose";
};

const creationShortcuts: AdminShortcut[] = [
  {
    to: "/customers/new?ctx=admin",
    title: "Create Customer",
    description: "Register a new customer profile for credit, dispatch, and pricing.",
    eyebrow: "Master Record",
    tone: "indigo",
  },
  {
    to: "/creation/employees/new",
    title: "Create Employee",
    description:
      "Open the dedicated onboarding form for cashier, rider, or staff-manager account creation.",
    eyebrow: "Workforce",
    tone: "emerald",
  },
  {
    to: "/customers?ctx=admin",
    title: "Create Discount Rule",
    description: "Open customer list, then go to Pricing Rules and add discount logic.",
    eyebrow: "Pricing",
    tone: "amber",
  },
  {
    to: "/products",
    title: "Create Product",
    description: "Add catalog items with pricing, stock, and packaging data.",
    eyebrow: "Catalog",
    tone: "sky",
  },
  {
    to: "/creation/vehicles",
    title: "Create Vehicle",
    description: "Add delivery vehicles and fleet unit details.",
    eyebrow: "Fleet Setup",
    tone: "rose",
  },
  {
    to: "/creation/areas",
    title: "Create Area",
    description: "Maintain municipality, barangay, zone, and landmark coverage.",
    eyebrow: "Geo Master",
    tone: "indigo",
  },
];

const supportCreationShortcuts: AdminShortcut[] = [
  {
    to: "/creation/provinces",
    title: "Create Province",
    description: "Create and maintain province records used in addresses.",
    tone: "sky",
  },
  {
    to: "/creation",
    title: "Product Option Library",
    description:
      "Admin-only options for product encoding: category choices, units, packing units, locations, brands, indications, and targets.",
    tone: "emerald",
  },
  {
    to: "/creation/riders",
    title: "Rider Directory",
    description: "Manage rider profile details and default vehicle assignments.",
    tone: "emerald",
  },
  {
    to: "/creation/employees",
    title: "Employee Directory",
    description: "Manage employee profile edits, compliance reminders, and account controls.",
    tone: "emerald",
  },
  {
    to: "/customers?ctx=admin",
    title: "Customer List",
    description: "Manage existing customers and open pricing-rule creation per customer.",
    tone: "amber",
  },
  {
    to: "/products",
    title: "Product Catalog",
    description: "Maintain existing product records after initial creation.",
    tone: "rose",
  },
];

export default function AdminDashboardIndex() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e0ecff_0%,_#f4f8ff_35%,_#f8fafc_100%)] text-slate-900">
      <SoTRoleShellHeader
        title="Admin Dashboard"
        identityLine="Creation-only hub for customer, rider, pricing, and product-option records."
        sticky
        actions={
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              title="Sign out"
            >
              Logout
            </button>
          </Form>
        }
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500 p-5 text-white shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">
            Admin Creation Hub
          </h2>
          <p className="mt-1 text-sm text-indigo-50/95">
            This dashboard is for creation tasks only. Manager operations are handled in the Manager Dashboard.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge text="Customer Creation" />
            <Badge text="Rider Creation" />
            <Badge text="Pricing Rules" />
            <Badge text="Product Options" />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Primary Creation
            </h2>
            <span className="text-xs text-slate-500">
              Fast actions for adding new records.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {creationShortcuts.map((item) => (
              <ShortcutCard key={item.title} item={item} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Creation Support
            </h2>
            <span className="text-xs text-slate-500">
              Admin libraries and maintenance entry points.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {supportCreationShortcuts.map((item) => (
              <ShortcutCard key={item.title} item={item} />
            ))}
          </div>
        </section>

        <SoTCard className="border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-amber-900">
                Discount Rule Workflow
              </h3>
              <p className="mt-1 text-xs text-amber-800">
                Discount creation is customer-based. Open Customers, pick customer, then open Pricing Rules.
              </p>
            </div>
            <Link
              to="/customers?ctx=admin"
              className="inline-flex h-9 items-center rounded-xl bg-amber-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Open Customers
            </Link>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}

function ShortcutCard({ item }: { item: AdminShortcut }) {
  const toneClasses: Record<AdminShortcut["tone"], string> = {
    indigo:
      "border-indigo-200 bg-indigo-50/70 text-indigo-900 hover:bg-indigo-100/70",
    emerald:
      "border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/70",
    amber:
      "border-amber-200 bg-amber-50/70 text-amber-900 hover:bg-amber-100/70",
    sky: "border-sky-200 bg-sky-50/70 text-sky-900 hover:bg-sky-100/70",
    rose: "border-rose-200 bg-rose-50/70 text-rose-900 hover:bg-rose-100/70",
  };

  return (
    <Link
      to={item.to}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
    >
      <SoTCard
        className={`h-full p-4 transition-colors duration-150 ${toneClasses[item.tone]}`}
      >
        {item.eyebrow ? (
          <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">
            {item.eyebrow}
          </div>
        ) : null}
        <div className="mt-1 text-sm font-semibold">{item.title}</div>
        <p className="mt-2 text-xs opacity-85">{item.description}</p>
      </SoTCard>
    </Link>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/40 bg-white/20 px-2.5 py-1 text-xs font-medium text-white">
      {text}
    </span>
  );
}
