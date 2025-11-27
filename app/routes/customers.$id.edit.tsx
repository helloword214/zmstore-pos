/* eslint-disable @typescript-eslint/no-explicit-any */
// app/routes/customers.$id.edit.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
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
  return json({ customer });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
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

  return redirect(`/customers/${id}`);
}

export default function EditCustomer() {
  const { customer } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header (matches POS style) */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Edit Customer —{" "}
            <span className="text-indigo-700">
              {[customer.firstName, customer.lastName]
                .filter(Boolean)
                .join(" ")}
            </span>
          </h1>
          <Link
            to={`/customers/${customer.id}`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-4xl px-5 py-6">
        {actionData && "error" in actionData && actionData.error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionData.error}
          </div>
        ) : null}

        <Form
          method="post"
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm grid gap-3 sm:grid-cols-2"
        >
          <label className="text-sm">
            <div className="text-slate-700">First Name</div>
            <input
              name="firstName"
              defaultValue={customer.firstName ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
            {actionData && (actionData as any).errors?.firstName ? (
              <div className="text-xs text-red-700 mt-1">
                {(actionData as any).errors.firstName}
              </div>
            ) : null}
          </label>

          <label className="text-sm">
            <div className="text-slate-700">Middle Name</div>
            <input
              name="middleName"
              defaultValue={customer.middleName ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="text-sm">
            <div className="text-slate-700">Last Name</div>
            <input
              name="lastName"
              defaultValue={customer.lastName ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
            {actionData && (actionData as any).errors?.lastName ? (
              <div className="text-xs text-red-700 mt-1">
                {(actionData as any).errors.lastName}
              </div>
            ) : null}
          </label>

          <label className="text-sm">
            <div className="text-slate-700">Alias</div>
            <input
              name="alias"
              defaultValue={customer.alias ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="text-sm">
            <div className="text-slate-700">Phone</div>
            <input
              name="phone"
              defaultValue={customer.phone ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="text-sm">
            <div className="text-slate-700">Credit Limit (PHP)</div>
            <input
              name="creditLimit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={customer.creditLimit ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
            {actionData && (actionData as any).errors?.creditLimit ? (
              <div className="text-xs text-red-700 mt-1">
                {(actionData as any).errors.creditLimit}
              </div>
            ) : null}
          </label>

          <label className="text-sm sm:col-span-2">
            <div className="text-slate-700">Notes</div>
            <textarea
              name="notes"
              rows={4}
              defaultValue={customer.notes ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <div className="sm:col-span-2 flex gap-2">
            <button
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              disabled={nav.state !== "idle"}
            >
              {nav.state !== "idle" ? "Saving…" : "Save Changes"}
            </button>
            <Link
              to={`/customers/${customer.id}`}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </Form>
      </div>
    </main>
  );
}

// UI-only page; keep data stable
export const shouldRevalidate = () => false;
