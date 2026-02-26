/* eslint-disable @typescript-eslint/no-explicit-any */
// customers.$id.pricing.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, Link } from "@remix-run/react";
import { PriceMode, UnitKind } from "@prisma/client";
import { db } from "~/utils/db.server";
import React from "react";
import { ProductPickerHybrid } from "~/components/ProductPickerHybrid";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const customerId = Number(params.id);
  const [customer, rawRules] = await Promise.all([
    db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, firstName: true, lastName: true, alias: true },
    }),

    db.customerItemPrice.findMany({
      where: { customerId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        productId: true,
        unitKind: true,
        mode: true,
        value: true,
        active: true,
        startsAt: true,
        endsAt: true,
        product: { select: { name: true } },
      },
    }),
  ]);
  if (!customer) throw new Response("Not found", { status: 404 });
  const rules = rawRules.map((r) => ({
    ...r,
    // Prisma Decimal -> number
    value: Number(r.value ?? 0),
  }));
  return json({ customer, rules });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const customerId = Number(params.id);
  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act === "create") {
    const productId = Number(fd.get("productId") || 0);
    const unitKind = String(fd.get("unitKind")) as UnitKind;
    const mode = String(fd.get("mode")) as PriceMode;
    const value = Number(fd.get("value") || 0);
    const startsAt = fd.get("startsAt")
      ? new Date(String(fd.get("startsAt")))
      : null;
    const endsAt = fd.get("endsAt") ? new Date(String(fd.get("endsAt"))) : null;
    const active = String(fd.get("active") || "1") === "1";

    if (!productId || !unitKind || !mode) {
      return json(
        { ok: false, error: "Product, unit kind and mode are required." },
        { status: 400 }
      );
    }
    if (value < 0) {
      return json({ ok: false, error: "Value must be ≥ 0." }, { status: 400 });
    }
    if (startsAt && endsAt && startsAt > endsAt) {
      return json(
        { ok: false, error: "Start must be ≤ End." },
        { status: 400 }
      );
    }

    // Overlap guard for ACTIVE rules of same (customer, product, unitKind)
    if (active) {
      const now = new Date();
      const overlaps = await db.customerItemPrice.findFirst({
        where: {
          customerId,
          productId,
          unitKind,
          active: true,
          OR: [
            { AND: [{ startsAt: null }, { endsAt: null }] },
            { AND: [{ startsAt: null }, { endsAt: { gte: startsAt ?? now } }] },
            { AND: [{ endsAt: null }, { startsAt: { lte: endsAt ?? now } }] },
            {
              AND: [
                { startsAt: { lte: endsAt ?? now } },
                { endsAt: { gte: startsAt ?? now } },
              ],
            },
          ],
        },
        select: { id: true },
      });
      if (overlaps) {
        return json(
          {
            ok: false,
            error: "There is already an active rule overlapping this period.",
          },
          { status: 400 }
        );
      }
    }

    await db.customerItemPrice.create({
      data: {
        customerId,
        productId,
        unitKind,
        mode,
        value,
        startsAt,
        endsAt,
        active,
      },
    });
    return redirect(`/customers/${customerId}/pricing`);
  }

  if (act === "toggleActive") {
    const id = Number(fd.get("id") || 0);
    const makeActive = String(fd.get("active") || "0") === "1";
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });

    if (makeActive) {
      // turning on: ensure no other active overlap
      const rule = await db.customerItemPrice.findUnique({
        where: { id },
        select: {
          productId: true,
          unitKind: true,
          startsAt: true,
          endsAt: true,
        },
      });
      if (!rule)
        return json({ ok: false, error: "Rule not found" }, { status: 404 });
      const now = new Date();
      const overlaps = await db.customerItemPrice.findFirst({
        where: {
          customerId,
          productId: rule.productId,
          unitKind: rule.unitKind,
          active: true,
          NOT: { id },
          OR: [
            { AND: [{ startsAt: null }, { endsAt: null }] },
            {
              AND: [
                { startsAt: null },
                { endsAt: { gte: rule.startsAt ?? now } },
              ],
            },
            {
              AND: [
                { endsAt: null },
                { startsAt: { lte: rule.endsAt ?? now } },
              ],
            },
            {
              AND: [
                { startsAt: { lte: rule.endsAt ?? now } },
                { endsAt: { gte: rule.startsAt ?? now } },
              ],
            },
          ],
        },
        select: { id: true },
      });
      if (overlaps) {
        return json(
          {
            ok: false,
            error: "Another active rule overlaps. Deactivate it first.",
          },
          { status: 400 }
        );
      }
    }

    await db.customerItemPrice.update({
      where: { id },
      data: { active: makeActive },
    });
    return redirect(`/customers/${customerId}/pricing`);
  }

  if (act === "delete") {
    const id = Number(fd.get("id") || 0);
    await db.customerItemPrice.delete({ where: { id } });
    return redirect(`/customers/${customerId}/pricing`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

// Mode-aware "Value" input. It watches the <select name="mode"> in the same form.
function ModeAwareValue() {
  const formRef = React.useRef<HTMLDivElement>(null);
  const [mode, setMode] = React.useState<
    "FIXED_PRICE" | "FIXED_DISCOUNT" | "PERCENT_DISCOUNT"
  >("FIXED_PRICE");

  React.useEffect(() => {
    const select = formRef.current
      ?.closest("form")
      ?.querySelector<HTMLSelectElement>('select[name="mode"]');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = () => setMode((select?.value as any) ?? "FIXED_PRICE");
    select?.addEventListener("change", handler);
    handler(); // initialize from current select value
    return () => select?.removeEventListener("change", handler);
  }, []);

  const label =
    mode === "FIXED_PRICE"
      ? "Final Price (₱)"
      : mode === "FIXED_DISCOUNT"
      ? "Discount Amount (₱ off)"
      : "Discount Percent (% off)";

  const step = "0.01";
  const min = "0";

  return (
    <div ref={formRef} className="text-sm">
      <div className="text-slate-700">{label}</div>
      <input
        name="value"
        type="number"
        step={step}
        min={min}
        className="mt-1 w-full rounded border px-3 py-2 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
      />
    </div>
  );
}

function formatRuleValue(
  mode: "FIXED_PRICE" | "FIXED_DISCOUNT" | "PERCENT_DISCOUNT",
  raw: any
) {
  const n = Number(raw ?? 0);
  if (mode === "PERCENT_DISCOUNT") return `${n.toFixed(2)}%`;
  // price or fixed discount → peso
  return `₱${n.toFixed(2)}`;
}

export default function CustomerPricingRules() {
  const { customer, rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const name = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="mx-auto max-w-3xl p-5">
      <h1 className="text-xl font-semibold mb-3">
        Pricing Rules — {name}
        {customer.alias ? ` (${customer.alias})` : ""}
      </h1>

      {actionData && "error" in actionData && actionData.error ? (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionData.error}
        </div>
      ) : null}

      {/* Create */}
      <Form
        method="post"
        className="rounded-2xl border bg-white p-4 mb-4 grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="_action" value="create" />
        <ProductPickerHybrid name="productId" />
        <label className="text-sm">
          <div className="text-slate-700">Unit</div>
          <select
            name="unitKind"
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            defaultValue="RETAIL"
          >
            <option value="RETAIL">Retail</option>
            <option value="PACK">Pack</option>
          </select>
        </label>
        <label className="text-sm">
          <div className="text-slate-700">Mode</div>
          <select
            name="mode"
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            defaultValue="FIXED_PRICE"
          >
            <option value="FIXED_PRICE">Fixed price</option>
            <option value="FIXED_DISCOUNT">Fixed discount</option>
            <option value="PERCENT_DISCOUNT">Percent discount</option>
          </select>
        </label>
        <ModeAwareValue />
        <label className="text-sm">
          <div className="text-slate-700">Starts</div>
          <input
            name="startsAt"
            type="datetime-local"
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          />
        </label>
        <label className="text-sm">
          <div className="text-slate-700">Ends</div>
          <input
            name="endsAt"
            type="datetime-local"
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          />
        </label>
        <label className="text-sm inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="active"
            value="1"
            defaultChecked
            className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          />
          <span>Active</span>
        </label>
        <div className="sm:col-span-2">
          <button className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1">
            Add Rule
          </button>
        </div>
      </Form>

      {/* List */}
      <div className="rounded-2xl border bg-white">
        {rules.length === 0 ? (
          <div className="p-4 text-sm text-slate-600">No rules yet.</div>
        ) : (
          rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-4 py-3 border-t first:border-t-0"
            >
              <div className="text-sm">
                <div className="font-medium">{r.product.name}</div>
                <div className="text-[11px] text-slate-600">
                  {r.unitKind} • {r.mode} • {formatRuleValue(r.mode, r.value)} •{" "}
                  {r.startsAt
                    ? new Date(r.startsAt).toLocaleString()
                    : "no start"}{" "}
                  → {r.endsAt ? new Date(r.endsAt).toLocaleString() : "no end"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={String(r.id)}
                  className="rounded-xl px-3 py-1.5 text-xs border bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Edit
                </Link>
                <Form method="post">
                  <input type="hidden" name="_action" value="toggleActive" />
                  <input type="hidden" name="id" value={r.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={r.active ? "0" : "1"}
                  />
                  <button
                    className={`rounded-xl px-3 py-1.5 text-xs border ${
                      r.active
                        ? "bg-amber-50 border-amber-200 text-amber-800"
                        : "bg-emerald-50 border-emerald-200 text-emerald-700"
                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
                  >
                    {r.active ? "Deactivate" : "Activate"}
                  </button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (!confirm("Delete rule?")) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="_action" value="delete" />
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded-xl px-3 py-1.5 text-xs border bg-red-50 border-red-200 text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1">
                    Delete
                  </button>
                </Form>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
