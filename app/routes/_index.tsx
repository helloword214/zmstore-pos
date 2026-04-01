import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link } from "@remix-run/react";

import {
  SoTDashboardActionGrid,
  SoTDashboardActionTile,
  SoTDashboardPanel,
  SoTDashboardQueueList,
  SoTDashboardQueueRow,
  SoTDashboardSection,
  SoTDashboardTopGrid,
} from "~/components/ui/SoTDashboardPrimitives";
import { SoTButton } from "~/components/ui/SoTButton";
import { requireRole } from "~/utils/auth.server";
import { SoTRoleShellHeader } from "~/components/ui/SoTRoleShellHeader";

type AdminShortcutTone = "info" | "success" | "warning" | "danger" | "default";

type AdminShortcut = {
  to: string;
  title: string;
  detail: string;
  actionLabel: string;
  badge?: string;
  tone: AdminShortcutTone;
};

const startHereShortcuts: AdminShortcut[] = [
  {
    to: "/creation/opening-ar-batches",
    title: "Opening AR Batches",
    detail: "Encode onboarding receivables",
    actionLabel: "Open",
    badge: "Priority",
    tone: "warning",
  },
  {
    to: "/customers/new?ctx=admin",
    title: "Customer Setup",
    detail: "Create customer profiles",
    actionLabel: "Open",
    tone: "info",
  },
  {
    to: "/creation/employees/new",
    title: "Employee Setup",
    detail: "Create cashier, rider, and staff accounts",
    actionLabel: "Open",
    tone: "success",
  },
];

const createShortcuts: AdminShortcut[] = [
  {
    to: "/customers/new?ctx=admin",
    title: "Customer",
    detail: "Credit and dispatch profile",
    actionLabel: "Create Customer",
    badge: "Master",
    tone: "info",
  },
  {
    to: "/creation/employees/new",
    title: "Employee",
    detail: "Workforce account",
    actionLabel: "Create Employee",
    badge: "Workforce",
    tone: "success",
  },
  {
    to: "/products/new",
    title: "Product",
    detail: "Catalog item",
    actionLabel: "Create Product",
    badge: "Catalog",
    tone: "info",
  },
  {
    to: "/creation/vehicles",
    title: "Vehicle",
    detail: "Fleet unit",
    actionLabel: "Create Vehicle",
    badge: "Fleet",
    tone: "danger",
  },
  {
    to: "/creation/areas",
    title: "Area",
    detail: "Coverage setup",
    actionLabel: "Create Area",
    badge: "Geo",
    tone: "info",
  },
  {
    to: "/creation/opening-ar-batches",
    title: "Opening AR Batch",
    detail: "Receivable onboarding",
    actionLabel: "Open Batches",
    badge: "AR",
    tone: "warning",
  },
];

const maintainShortcuts: AdminShortcut[] = [
  {
    to: "/customers?ctx=admin",
    title: "Customers",
    detail: "Profiles and pricing access",
    actionLabel: "Open Customers",
    tone: "warning",
  },
  {
    to: "/products",
    title: "Products",
    detail: "Catalog and pricing upkeep",
    actionLabel: "Open Products",
    tone: "danger",
  },
  {
    to: "/creation",
    title: "Product Options",
    detail: "Category, unit, brand, and target library",
    actionLabel: "Open Options",
    tone: "success",
  },
  {
    to: "/creation/riders",
    title: "Rider Directory",
    detail: "Rider profiles and default vehicle assignments",
    actionLabel: "Open Riders",
    tone: "success",
  },
  {
    to: "/creation/employees",
    title: "Employee Directory",
    detail: "Profiles, compliance, and account controls",
    actionLabel: "Open Employees",
    tone: "success",
  },
  {
    to: "/creation/workforce/pay-profiles",
    title: "Pay Profiles",
    detail: "Effective-dated pay setup",
    actionLabel: "Open Pay Profiles",
    tone: "success",
  },
];

const supportShortcuts: AdminShortcut[] = [
  {
    to: "/creation/provinces",
    title: "Provinces",
    detail: "Address master data",
    actionLabel: "Open",
    tone: "info",
  },
  {
    to: "/creation/workforce/payroll-policy",
    title: "Payroll Policy",
    detail: "Cutoffs, premiums, and attendance incentives",
    actionLabel: "Open",
    tone: "warning",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  return null;
}

export default function AdminDashboardIndex() {
  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTRoleShellHeader
        title="Admin Dashboard"
        identityLine="Master data and setup"
        sticky
        actions={
          <>
            <Link to="/account/security">
              <SoTButton title="Account security" variant="secondary">
                Account
              </SoTButton>
            </Link>
            <Form method="post" action="/logout">
              <SoTButton title="Sign out" variant="secondary">
                Logout
              </SoTButton>
            </Form>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
        <SoTDashboardTopGrid>
          <div className="xl:col-span-3">
            <SoTDashboardPanel
              title="Start Here"
              subtitle="High-frequency admin work"
              badge="Launchpad"
              tone="info"
            >
              <SoTDashboardQueueList>
                {startHereShortcuts.map((item) => (
                  <SoTDashboardQueueRow
                    key={item.title}
                    to={item.to}
                    label={item.title}
                    value={item.detail}
                    actionLabel={item.actionLabel}
                    tone={item.tone}
                  />
                ))}
              </SoTDashboardQueueList>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-6">
            <SoTDashboardPanel
              title="Create"
              subtitle="Master data and onboarding"
              badge="Primary"
              tone="info"
            >
              <SoTDashboardActionGrid className="xl:!grid-cols-2">
                {createShortcuts.map((item) => (
                  <SoTDashboardActionTile
                    key={item.title}
                    to={item.to}
                    title={item.title}
                    detail={item.detail}
                    actionLabel={item.actionLabel}
                    badge={item.badge}
                    badgePlacement="stacked"
                    tone={item.tone}
                  />
                ))}
              </SoTDashboardActionGrid>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-3">
            <SoTDashboardPanel
              title="Maintain"
              subtitle="Directories and policy entry points"
              badge="Secondary"
            >
              <SoTDashboardQueueList>
                {maintainShortcuts.slice(0, 4).map((item) => (
                  <SoTDashboardQueueRow
                    key={item.title}
                    to={item.to}
                    label={item.title}
                    value={item.detail}
                    actionLabel="Open"
                    tone={item.tone}
                  />
                ))}
              </SoTDashboardQueueList>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardTopGrid>

        <SoTDashboardSection
          title="Quick Actions"
          subtitle="Libraries and maintenance"
        >
          <SoTDashboardActionGrid>
            {maintainShortcuts.map((item) => (
              <SoTDashboardActionTile
                key={item.title}
                to={item.to}
                title={item.title}
                detail={item.detail}
                actionLabel={item.actionLabel}
                tone={item.tone}
              />
            ))}
          </SoTDashboardActionGrid>
        </SoTDashboardSection>

        <SoTDashboardSection
          title="Reference"
          subtitle="Only the workflows that still need extra context"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <SoTDashboardPanel
              title="Pricing Rules"
              subtitle="Customer-based workflow"
              badge="Important"
              tone="warning"
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Pricing rules are created from the customer record.
                </p>
                <Link
                  to="/customers?ctx=admin"
                  className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Open Customers
                </Link>
              </div>
            </SoTDashboardPanel>

            <SoTDashboardPanel
              title="Support"
              subtitle="Lower-frequency setup"
            >
              <SoTDashboardQueueList>
                {supportShortcuts.map((item) => (
                  <SoTDashboardQueueRow
                    key={item.title}
                    to={item.to}
                    label={item.title}
                    value={item.detail}
                    actionLabel={item.actionLabel}
                    tone={item.tone}
                  />
                ))}
              </SoTDashboardQueueList>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardSection>
      </div>
    </main>
  );
}
