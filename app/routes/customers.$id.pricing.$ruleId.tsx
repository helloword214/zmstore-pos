// app/routes/customers.$id.pricing.$ruleId.tsx
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
import { db } from "~/utils/db.server";

type LoaderData = {
  customerId: number;
  customerName: string;
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

export async function loader({ params }: LoaderFunctionArgs) {
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
  const customerId = Number(params.id);
  const ruleId = Number(params.ruleId);
  if (!Number.isFinite(customerId) || !Number.isFinite(ruleId)) {
    return json({ ok: false, formError: "Invalid params" }, { status: 400 });
  }

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act === "delete") {
    await db.customerItemPrice.delete({ where: { id: ruleId } });
    return redirect(`/customers/${customerId}/pricing`);
  }

  if (act === "save") {
    const productId = Number(fd.get("productId") || 0);
    const unitKind = String(fd.get("unitKind") || "") as UnitKind;
    const mode = String(fd.get("mode") || "") as PriceMode;
    const value = Number(fd.get("value") || 0);
    const active = fd.get("active") === "on";
    const startsAtStr = String(fd.get("startsAt") || "").trim();
    const endsAtStr = String(fd.get("endsAt") || "").trim();
    const startsAt = startsAtStr ? new Date(startsAtStr) : null;
    const endsAt = endsAtStr ? new Date(endsAtStr) : null;

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

    return redirect(`/customers/${customerId}/pricing`);
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

  return (
    <section className="px-4 md:px-0 pb-6">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-5 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Edit Rule — <span className="text-indigo-700">{customerName}</span>
          </h1>
          <Link
            to={`/customers/${customerId}/pricing`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Back
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-5 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <Form method="post" className="space-y-3">
            {actionData && "formError" in actionData && actionData.formError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionData.formError}
              </div>
            ) : null}

            <label className="block text-sm">
              <span className="text-slate-700">Product</span>
              <select
                name="productId"
                defaultValue={String(rule.productId)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {actionData &&
            "fieldErrors" in actionData &&
            actionData.fieldErrors?.productId ? (
              <div className="text-xs text-red-700">
                {actionData.fieldErrors.productId}
              </div>
            ) : null}

            <label className="block text-sm">
              <span className="text-slate-700">Unit Kind</span>
              <div className="mt-1 flex gap-3">
                {(["RETAIL", "PACK"] as const).map((k) => (
                  <label
                    key={k}
                    className="inline-flex items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="unitKind"
                      value={k}
                      defaultChecked={rule.unitKind === k}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>{k}</span>
                  </label>
                ))}
              </div>
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Mode</span>
              <select
                name="mode"
                defaultValue={rule.mode}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                <option value="FIXED_PRICE">FIXED_PRICE (set new price)</option>
                <option value="FIXED_DISCOUNT">FIXED_DISCOUNT (minus ₱)</option>
                <option value="PERCENT_DISCOUNT">
                  PERCENT_DISCOUNT (minus %)
                </option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Value</span>
              <input
                name="value"
                type="number"
                step="0.01"
                min="0"
                defaultValue={rule.value}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              />
            </label>
            {actionData &&
            "fieldErrors" in actionData &&
            actionData.fieldErrors?.value ? (
              <div className="text-xs text-red-700">
                {actionData.fieldErrors.value}
              </div>
            ) : null}

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                name="active"
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                defaultChecked={rule.active}
              />
              <span>Active</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-700">Starts At (optional)</span>
                <input
                  name="startsAt"
                  type="date"
                  defaultValue={rule.startsAt ?? ""}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Ends At (optional)</span>
                <input
                  name="endsAt"
                  type="date"
                  defaultValue={rule.endsAt ?? ""}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                name="_action"
                value="save"
                className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                disabled={nav.state !== "idle"}
              >
                {nav.state !== "idle" ? "Saving…" : "Save"}
              </button>

              <button
                name="_action"
                value="delete"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                onClick={(e) => {
                  if (!confirm("Delete this rule? This cannot be undone."))
                    e.preventDefault();
                }}
              >
                Delete
              </button>
            </div>
          </Form>
        </div>
      </div>
    </section>
  );
}
