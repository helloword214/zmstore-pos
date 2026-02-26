// app/routes/customers.$id_.pricing_.$ruleId.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { PriceMode, UnitKind } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

type LoaderData = {
  customerId: number;
  customerName: string;
  ctx: "admin";
  rule: {
    id: number;
    productId: number;
    productName: string;
    unitKind: UnitKind;
    mode: PriceMode;
    value: number;
    active: boolean;
    startsAt: string | null;
    endsAt: string | null;
  };
  products: Array<{ id: number; name: string }>;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const ctx = "admin";
  const customerId = Number(params.id);
  const ruleId = Number(params.ruleId);
  if (!Number.isFinite(customerId) || !Number.isFinite(ruleId)) {
    throw new Response("Invalid params", { status: 400 });
  }
  const [cust, rule, products] = await Promise.all([
    db.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        alias: true,
      },
    }),
    db.customerItemPrice.findUnique({
      where: { id: ruleId },
      include: { product: { select: { name: true } } },
    }),
    db.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);
  if (!cust || !rule || rule.customerId !== customerId)
    throw new Response("Not found", { status: 404 });

  const name =
    `${cust.firstName}${cust.middleName ? ` ${cust.middleName}` : ""} ${
      cust.lastName
    }`.trim() + (cust.alias ? ` (${cust.alias})` : "");

  return json<LoaderData>({
    customerId,
    customerName: name,
    products,
    ctx,
    rule: {
      id: rule.id,
      productId: rule.productId,
      productName: rule.product?.name ?? `#${rule.productId}`,
      unitKind: rule.unitKind,
      mode: rule.mode,
      value: Number(rule.value ?? 0),
      active: rule.active,
      startsAt: rule.startsAt ? rule.startsAt.toISOString().slice(0, 10) : null,
      endsAt: rule.endsAt ? rule.endsAt.toISOString().slice(0, 10) : null,
    },
  });
}

type ActionData =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const ctxSuffix = "?ctx=admin";
  const customerId = Number(params.id);
  const ruleId = Number(params.ruleId);
  if (!Number.isFinite(customerId) || !Number.isFinite(ruleId)) {
    return json({ ok: false, formError: "Invalid params" }, { status: 400 });
  }

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act === "delete") {
    await db.customerItemPrice.delete({ where: { id: ruleId } });
    return redirect(`/customers/${customerId}/pricing${ctxSuffix}`);
  }

  if (act === "save") {
    const productId = Number(fd.get("productId") || 0);
    const unitKind = String(fd.get("unitKind") || "") as UnitKind;
    const mode = String(fd.get("mode") || "") as PriceMode;
    const value = Number(fd.get("value") || 0);
    const active = fd.get("active") === "on";
    const startsAtStr = String(fd.get("startsAt") || "").trim();
    const endsAtStr = String(fd.get("endsAt") || "").trim();
    const startsAt = startsAtStr ? new Date(`${startsAtStr}T00:00:00`) : null;
    const endsAt = endsAtStr ? new Date(`${endsAtStr}T23:59:59.999`) : null;

    const fieldErrors: Record<string, string> = {};
    if (!Number.isFinite(productId) || productId <= 0)
      fieldErrors.productId = "Select a product";
    if (!["RETAIL", "PACK"].includes(unitKind))
      fieldErrors.unitKind = "Choose unit kind";
    if (!["FIXED_PRICE", "FIXED_DISCOUNT", "PERCENT_DISCOUNT"].includes(mode))
      fieldErrors.mode = "Choose mode";
    if (!Number.isFinite(value)) fieldErrors.value = "Enter a number";
    if (value < 0) fieldErrors.value = "Value must be ≥ 0";
    if (startsAt && isNaN(+startsAt)) fieldErrors.startsAt = "Invalid date";
    if (endsAt && isNaN(+endsAt)) fieldErrors.endsAt = "Invalid date";
    if (startsAt && endsAt && +startsAt > +endsAt)
      fieldErrors.endsAt = "End date must be after start date";

    // product must exist
    const prod = await db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!prod) fieldErrors.productId = "Product not found";

    if (Object.keys(fieldErrors).length) {
      return json<ActionData>({ ok: false, fieldErrors }, { status: 400 });
    }

    // overlap check for ACTIVE rules (exclude this rule)
    if (active) {
      const overlaps = await db.customerItemPrice.findFirst({
        where: {
          customerId,
          productId,
          unitKind,
          active: true,
          NOT: { id: ruleId },
          AND: [
            {
              OR: [
                { startsAt: null },
                { startsAt: { lte: endsAt ?? new Date("9999-12-31") } },
              ],
            },
            {
              OR: [
                { endsAt: null },
                { endsAt: { gte: startsAt ?? new Date("0001-01-01") } },
              ],
            },
          ],
        },
        select: { id: true },
      });
      if (overlaps) {
        return json<ActionData>(
          {
            ok: false,
            formError: "Overlapping ACTIVE rule exists for this product/unit.",
          },
          { status: 400 }
        );
      }
    }

    await db.customerItemPrice.update({
      where: { id: ruleId },
      data: {
        productId,
        unitKind,
        mode,
        value,
        active,
        startsAt: startsAt ?? null,
        endsAt: endsAt ?? null,
      },
    });

    return redirect(`/customers/${customerId}/pricing${ctxSuffix}`);
  }

  return json<ActionData>(
    { ok: false, formError: "Unknown action" },
    { status: 400 }
  );
}

export default function EditCustomerRule() {
  const { customerId, customerName, products, rule } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const ctxSuffix = "?ctx=admin";
  const fieldErrors =
    actionData && "fieldErrors" in actionData ? actionData.fieldErrors : undefined;
  const formError =
    actionData && "formError" in actionData ? actionData.formError : undefined;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Edit Pricing Rule"
        subtitle={customerName}
        backTo={`/customers/${customerId}/pricing${ctxSuffix}`}
        backLabel="Pricing Rules"
        maxWidthClassName="max-w-3xl"
      />

      <div className="mx-auto max-w-3xl px-5 py-6">
        <SoTCard interaction="form">
          <Form method="post" className="space-y-3">
            {formError ? <SoTAlert tone="danger">{formError}</SoTAlert> : null}

            <SoTFormField label="Product" error={fieldErrors?.productId}>
              <select
                name="productId"
                defaultValue={String(rule.productId)}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </SoTFormField>

            <SoTFormField label="Unit Kind" error={fieldErrors?.unitKind}>
              <div className="mt-1 flex gap-3">
                {(["RETAIL", "PACK"] as const).map((k) => (
                  <label key={k} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="unitKind"
                      value={k}
                      defaultChecked={rule.unitKind === k}
                      className="h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    />
                    <span>{k}</span>
                  </label>
                ))}
              </div>
            </SoTFormField>

            <SoTFormField label="Mode" error={fieldErrors?.mode}>
              <select
                name="mode"
                defaultValue={rule.mode}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                <option value="FIXED_PRICE">FIXED_PRICE (set new price)</option>
                <option value="FIXED_DISCOUNT">FIXED_DISCOUNT (minus PHP)</option>
                <option value="PERCENT_DISCOUNT">PERCENT_DISCOUNT (minus %)</option>
              </select>
            </SoTFormField>

            <SoTFormField label="Value" error={fieldErrors?.value}>
              <input
                name="value"
                type="number"
                step="0.01"
                min="0"
                defaultValue={rule.value}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                name="active"
                type="checkbox"
                className="h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                defaultChecked={rule.active}
              />
              <span>Active</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <SoTFormField label="Starts At (optional)" error={fieldErrors?.startsAt}>
                <input
                  name="startsAt"
                  type="date"
                  defaultValue={rule.startsAt ?? ""}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                />
              </SoTFormField>
              <SoTFormField label="Ends At (optional)" error={fieldErrors?.endsAt}>
                <input
                  name="endsAt"
                  type="date"
                  defaultValue={rule.endsAt ?? ""}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                />
              </SoTFormField>
            </div>

            <SoTActionBar
              className="mb-0"
              right={
                <>
                  <SoTButton
                    type="submit"
                    name="_action"
                    value="save"
                    variant="primary"
                    disabled={nav.state !== "idle"}
                  >
                    {nav.state !== "idle" ? "Saving..." : "Save"}
                  </SoTButton>

                  <SoTButton
                    type="submit"
                    name="_action"
                    value="delete"
                    variant="danger"
                    onClick={(e) => {
                      if (!confirm("Delete this rule? This cannot be undone.")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Delete
                  </SoTButton>

                  <Link
                    to={`/customers/${customerId}/pricing${ctxSuffix}`}
                    className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Cancel
                  </Link>
                </>
              }
            />
          </Form>
        </SoTCard>
      </div>
    </main>
  );
}
