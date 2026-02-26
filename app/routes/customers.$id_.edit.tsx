// app/routes/customers.$id_.edit.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const url = new URL(request.url);
  const ctx = url.searchParams.get("ctx") === "admin" ? "admin" : null;
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      creditLimit: true,
      notes: true,
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });
  return json({ customer, ctx });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const url = new URL(request.url);
  const ctx = url.searchParams.get("ctx") === "admin" ? "admin" : null;
  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });

  const fd = await request.formData();
  const firstName = String(fd.get("firstName") || "").trim();
  const middleName = (String(fd.get("middleName") || "").trim() || null) as
    | string
    | null;
  const lastName = String(fd.get("lastName") || "").trim();
  const alias = (String(fd.get("alias") || "").trim() || null) as string | null;
  const phone = (String(fd.get("phone") || "").trim() || null) as string | null;
  const creditLimitRaw = fd.get("creditLimit");
  const creditLimit =
    creditLimitRaw === null || String(creditLimitRaw).trim() === ""
      ? null
      : Number(creditLimitRaw);
  const notes = (String(fd.get("notes") || "").trim() || null) as string | null;

  const errors: Record<string, string> = {};
  if (!firstName) errors.firstName = "Required";
  if (!lastName) errors.lastName = "Required";
  if (creditLimit !== null && !Number.isFinite(creditLimit)) {
    errors.creditLimit = "Enter a number";
  }

  if (Object.keys(errors).length) {
    return json({ ok: false, errors }, { status: 400 });
  }

  await db.customer.update({
    where: { id },
    data: { firstName, middleName, lastName, alias, phone, creditLimit, notes },
  });

  const ctxSuffix = ctx === "admin" ? "?ctx=admin" : "";
  return redirect(`/customers/${id}${ctxSuffix}`);
}

export default function EditCustomer() {
  const { customer, ctx } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();
  const backHref =
    ctx === "admin" ? `/customers/${customer.id}?ctx=admin` : `/customers/${customer.id}`;
  const fieldErrors = actionData && "errors" in actionData ? actionData.errors : undefined;
  const formError = actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Edit Customer"
        subtitle={[customer.firstName, customer.lastName].filter(Boolean).join(" ")}
        backTo={backHref}
        backLabel="Customer Profile"
        maxWidthClassName="max-w-4xl"
      />

      <div className="mx-auto max-w-4xl px-5 py-6">
        {formError ? (
          <SoTAlert tone="danger" className="mb-3">
            {formError}
          </SoTAlert>
        ) : null}

        <SoTCard interaction="form">
          <Form method="post" className="grid gap-3 sm:grid-cols-2">
            <SoTFormField label="First Name" error={fieldErrors?.firstName}>
              <input
                name="firstName"
                defaultValue={customer.firstName ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Middle Name">
              <input
                name="middleName"
                defaultValue={customer.middleName ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Last Name" error={fieldErrors?.lastName}>
              <input
                name="lastName"
                defaultValue={customer.lastName ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Alias">
              <input
                name="alias"
                defaultValue={customer.alias ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Phone">
              <input
                name="phone"
                defaultValue={customer.phone ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField
              label="Credit Limit (PHP)"
              error={fieldErrors?.creditLimit}
            >
              <input
                name="creditLimit"
                type="number"
                step="0.01"
                min="0"
                defaultValue={customer.creditLimit ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Notes" className="sm:col-span-2">
              <textarea
                name="notes"
                rows={4}
                defaultValue={customer.notes ?? ""}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <div className="sm:col-span-2">
              <SoTActionBar
                className="mb-0"
                right={
                  <>
                    <Link
                      to={backHref}
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    >
                      Cancel
                    </Link>
                    <SoTButton
                      type="submit"
                      variant="primary"
                      disabled={nav.state !== "idle"}
                    >
                      {nav.state !== "idle" ? "Saving..." : "Save Changes"}
                    </SoTButton>
                  </>
                }
              />
            </div>
          </Form>
        </SoTCard>
      </div>
    </main>
  );
}

// UI-only page; keep data stable
export const shouldRevalidate = () => false;
