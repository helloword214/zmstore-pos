/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import * as React from "react";
import { SoTDropdown } from "~/components/ui/SoTDropdown";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTRoleShellHeader } from "~/components/ui/SoTRoleShellHeader";
import { SoTPageHeader } from "~/components/ui/SoTPageHeader";

type ActionData =
  | { ok: true; redirectedTo: string }
  | { ok: false; error: string };

function makeRunCode() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RN-${y}${m}${day}-${rand}`;
}

function clampTake(n: number, fallback = 50) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(200, Math.floor(n)));
}

type SortKey = "id" | "printedAt" | "stagedAt" | "amount";
type SortDir = "asc" | "desc";

function parseSortKey(raw: string | null): SortKey {
  const v = String(raw || "").trim();
  if (v === "printedAt") return "printedAt";
  if (v === "stagedAt") return "stagedAt";
  if (v === "amount") return "amount";
  return "id";
}
function parseSortDir(raw: string | null): SortDir {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "asc" ? "asc" : "desc";
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Store Manager (or Admin) lang ang pwede dito
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"] as any);

  const userRow = await db.user.findUnique({
    where: { id: me.userId },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });
  const emp = userRow.employee;
  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "Unknown user";
  const alias = emp?.alias ?? null;

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const sort = parseSortKey(url.searchParams.get("sort"));
  const dir = parseSortDir(url.searchParams.get("dir"));
  const take = clampTake(Number(url.searchParams.get("take") || 50), 50);

  // Build orderBy
  const orderBy: any[] = [];
  if (sort === "amount") {
    // pick a stable amount column you already have (fallback-safe)
    // Prefer totalBeforeDiscount (often includes discounts logic), then subtotal.
    orderBy.push({ totalBeforeDiscount: dir });
    orderBy.push({ subtotal: dir });
    orderBy.push({ id: "desc" });
  } else {
    orderBy.push({ [sort]: dir });
    // stable tie-breaker
    if (sort !== "id") orderBy.push({ id: "desc" });
  }

  const forDispatch = await db.order.findMany({
    where: {
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: null,
      ...(q
        ? {
            OR: [
              { orderCode: { contains: q, mode: "insensitive" as any } },
              { riderName: { contains: q, mode: "insensitive" as any } },
              {
                customer: {
                  OR: [
                    { alias: { contains: q, mode: "insensitive" as any } },
                    { firstName: { contains: q, mode: "insensitive" as any } },
                    { lastName: { contains: q, mode: "insensitive" as any } },
                    { phone: { contains: q, mode: "insensitive" as any } },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    orderBy,
    take,
    select: {
      id: true,
      orderCode: true,
      riderName: true,
      stagedAt: true,
      dispatchedAt: true,
      fulfillmentStatus: true,
      subtotal: true,
      totalBeforeDiscount: true,
      printedAt: true,
      customer: {
        select: {
          alias: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
    },
  });

  // PLANNED runs only (pwede pag-assign-an)
  const plannedRuns = await db.deliveryRun.findMany({
    where: { status: "PLANNED" },
    orderBy: [{ id: "desc" }],
    take: 30,
    select: {
      id: true,
      runCode: true,
      rider: { select: { alias: true, firstName: true, lastName: true } },
      vehicle: { select: { name: true } },
    },
  });

  const runOptions = plannedRuns.map((r) => {
    const riderLabel =
      r.rider?.alias?.trim() ||
      [r.rider?.firstName, r.rider?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null;
    const vehicleLabel = r.vehicle?.name ?? null;
    const label = [
      r.runCode,
      riderLabel ? `• ${riderLabel}` : null,
      vehicleLabel ? `• ${vehicleLabel}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return { id: r.id, label };
  });

  const [dispatchQueueCount, clearancePending] = await Promise.all([
    db.order.count({
      where: {
        channel: "DELIVERY",
        status: { in: ["UNPAID", "PARTIALLY_PAID"] },
        dispatchedAt: null,
      },
    }),
    db.runReceipt.count({
      where: {
        run: { status: "CHECKED_IN" as any },
        kind: { in: ["ROAD", "PARENT"] as any },
        OR: [
          { cashCollected: { lte: 0 as any } },
          { note: { contains: '"isCredit":true' } },
          { note: { contains: '"isCredit": true' } },
        ],
      },
    }),
  ]);

  return json({
    me: {
      role: me.role,
      name: fullName,
      alias,
      email: userRow.email ?? "",
    },
    counts: { dispatchQueue: dispatchQueueCount, clearancePending },
    forDispatch,
    runOptions,
    q,
    sort,
    dir,
    take,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"] as any);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  const idsRaw = String(fd.get("orderIds") || "").trim();
  const orderIds = idsRaw
    .split(",")
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (orderIds.length === 0) {
    return json<ActionData>(
      { ok: false, error: "Select at least 1 order." },
      { status: 400 }
    );
  }

  // Safety: only eligible orders
  const eligible = await db.order.findMany({
    where: {
      id: { in: orderIds },
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: null,
    },
    select: { id: true },
  });
  const eligibleIds = new Set(eligible.map((o) => o.id));
  const finalIds = orderIds.filter((id) => eligibleIds.has(id));
  if (finalIds.length === 0) {
    return json<ActionData>(
      { ok: false, error: "Selected orders are no longer eligible." },
      { status: 400 }
    );
  }

  if (intent === "create-run") {
    const run = await db.$transaction(async (tx) => {
      // unique runCode retry
      let runCode = makeRunCode();
      let newRun: { id: number } | null = null;
      for (let i = 0; i < 4; i++) {
        try {
          newRun = await tx.deliveryRun.create({
            data: { runCode, status: "PLANNED" },
            select: { id: true },
          });
          break;
        } catch {
          runCode = makeRunCode();
        }
      }
      if (!newRun) throw new Error("Failed to create run");

      await tx.deliveryRunOrder.createMany({
        data: finalIds.map((orderId) => ({ runId: newRun!.id, orderId })),
        // if you have unique constraint (runId,orderId), this prevents duplicates
        skipDuplicates: true as any,
      });
      return newRun;
    });

    return redirect(`/runs/${run.id}/dispatch`);
  }

  if (intent === "assign-run") {
    const runId = Number(fd.get("runId") || NaN);
    if (!Number.isFinite(runId) || runId <= 0) {
      return json<ActionData>(
        { ok: false, error: "Select a PLANNED run." },
        { status: 400 }
      );
    }

    const run = await db.deliveryRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true },
    });
    if (!run || run.status !== "PLANNED") {
      return json<ActionData>(
        { ok: false, error: "Run must be PLANNED." },
        { status: 400 }
      );
    }

    await db.deliveryRunOrder.createMany({
      data: finalIds.map((orderId) => ({ runId, orderId })),
      skipDuplicates: true as any,
    });

    return redirect(`/runs/${runId}/dispatch`);
  }

  return json<ActionData>(
    { ok: false, error: "Unknown intent." },
    { status: 400 }
  );
}

export default function StoreDispatchQueuePage() {
  const { me, counts, forDispatch, runOptions, q, sort, dir, take } =
    useLoaderData<typeof loader>() as any;
  const actionData = useActionData<ActionData>();
  const [sp] = useSearchParams();
  const needAssignOrderId = Number(sp.get("needAssignOrderId") || NaN);

  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [runId, setRunId] = React.useState<string>("");
  const [searchQuery, setSearchQuery] = React.useState<string>(q || "");

  // Auto-select/highlight when redirected back from /orders/:id/dispatch
  React.useEffect(() => {
    if (Number.isFinite(needAssignOrderId) && needAssignOrderId > 0) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.add(needAssignOrderId);
        return next;
      });
    }
  }, [needAssignOrderId]);

  const allIds = forDispatch.map((o: any) => o.id);
  const selectedCount = selected.size;
  const selectedCsv = Array.from(selected).join(",");
  const allChecked =
    allIds.length > 0 && allIds.every((id: number) => selected.has(id));

  const sortLabel = (k: string) => {
    if (k === "printedAt") return "Printed time";
    if (k === "stagedAt") return "Staged time";
    if (k === "amount") return "Amount";
    return "Newest";
  };

  const customerLabel = (c: any) => {
    if (!c) return "—";
    const name = (
      String(c.alias || "").trim() ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      ""
    ).trim();
    return name || "—";
  };

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTRoleShellHeader
        sticky
        maxWidthClassName="max-w-5xl"
        title="Store Manager Dashboard"
        identityLine={
          <>
            <span className="font-medium text-slate-700">
              {me.alias ? `${me.alias} (${me.name})` : me.name}
            </span>
            {" · "}
            <span className="uppercase tracking-wide">{me.role}</span>
            {" · "}
            <span>{me.email}</span>
          </>
        }
        navItems={[
          {
            to: "/store/dispatch",
            label: "Dispatch",
            badge: counts.dispatchQueue,
            active: true,
          },
          {
            to: "/store/clearance",
            label: "Clearance",
            badge: counts.clearancePending,
          },
          { to: "/runs", label: "Runs" },
          { to: "/products", label: "Products" },
        ]}
        actions={
          <Form method="post" action="/logout">
            <button
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              title="Sign out"
            >
              Logout
            </button>
          </Form>
        }
      />
      <SoTPageHeader
        maxWidthClassName="max-w-5xl"
        title="Delivery Dispatch Queue"
        subtitle="Orders from pad-order marked as DELIVERY and not yet dispatched."
        actions={
          <>
            <Link
              to="/runs/new"
              className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              + New Run
            </Link>
            <Link
              to="/store"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to Store Dashboard
            </Link>
          </>
        }
      />

      {/* Body */}
      <div className="mx-auto max-w-5xl px-5 pb-6">
        {actionData && !actionData.ok && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionData.error}
          </div>
        )}

        {/* Search + Sort */}
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <Form
            method="get"
            className="grid gap-2 sm:grid-cols-12 sm:items-end"
            autoComplete="off"
          >
            <input type="hidden" name="q" value={searchQuery} />
            <input
              type="text"
              name="__no_autofill"
              autoComplete="username"
              tabIndex={-1}
              className="hidden"
              aria-hidden="true"
            />
            <div className="sm:col-span-6">
              <SoTInput
                label="Search"
                name="dispatchSearch"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder="Order code / customer / phone / rider…"
                className="h-9"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoCapitalize="off"
                inputMode="search"
                aria-autocomplete="none"
                readOnly
                data-lpignore="true"
                onFocus={(e) => {
                  e.currentTarget.readOnly = false;
                }}
                onBlur={(e) => {
                  e.currentTarget.readOnly = true;
                }}
              />
            </div>

            <div className="sm:col-span-3">
              <SoTDropdown
                label="Sort"
                name="sort"
                defaultValue={sort || "id"}
              >
                <option value="id">Newest</option>
                <option value="printedAt">Printed time</option>
                <option value="stagedAt">Staged time</option>
                <option value="amount">Amount</option>
              </SoTDropdown>
            </div>

            <div className="sm:col-span-2">
              <SoTDropdown
                label="Direction"
                name="dir"
                defaultValue={dir || "desc"}
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </SoTDropdown>
            </div>

            <div className="sm:col-span-1">
              <button
                type="submit"
                className="h-9 w-full rounded-xl bg-indigo-600 px-3 text-sm text-white"
              >
                Apply
              </button>
            </div>

            {/* keep take stable if user set it */}
            <input type="hidden" name="take" value={String(take || 50)} />
          </Form>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Showing:{" "}
              <span className="font-semibold">{forDispatch.length}</span> /{" "}
              {take || 50}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Sort:{" "}
              <span className="font-semibold">{sortLabel(sort || "id")}</span> •{" "}
              <span className="font-semibold">
                {String(dir || "desc").toUpperCase()}
              </span>
            </span>
            {q ? (
              <Link
                to={`?sort=${encodeURIComponent(
                  sort || "id"
                )}&dir=${encodeURIComponent(
                  dir || "desc"
                )}&take=${encodeURIComponent(String(take || 50))}`}
                className="rounded-full border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50"
              >
                Clear search
              </Link>
            ) : null}
          </div>
        </div>

        {/* Bulk actions */}
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-700">
              Selected: <span className="font-semibold">{selectedCount}</span>
            </div>

            <Form
              method="post"
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input type="hidden" name="orderIds" value={selectedCsv} />

              <div className="flex items-center gap-2">
                <SoTDropdown
                  name="runId"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                  className="w-auto min-w-[240px]"
                >
                  <option value="">— Assign to PLANNED run —</option>
                  {runOptions.map((r: any) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.label}
                    </option>
                  ))}
                </SoTDropdown>

                <button
                  type="submit"
                  name="intent"
                  value="assign-run"
                  disabled={selectedCount === 0 || !runId}
                  className="h-9 rounded-xl bg-indigo-600 px-3 text-sm text-white disabled:opacity-50"
                  title={
                    !runId
                      ? "Choose a PLANNED run"
                      : "Assign selected orders to this run"
                  }
                >
                  Assign
                </button>

                <button
                  type="submit"
                  name="intent"
                  value="create-run"
                  disabled={selectedCount === 0}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  title="Create a new run containing the selected orders"
                >
                  Create Run from Selected
                </button>
              </div>
            </Form>
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50"
              onClick={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (allChecked) {
                    // uncheck all visible
                    for (const id of allIds) next.delete(id);
                  } else {
                    // check all visible
                    for (const id of allIds) next.add(id);
                  }
                  return next;
                });
              }}
              disabled={allIds.length === 0}
            >
              {allChecked ? "Unselect all" : "Select all"}
            </button>
            {Number.isFinite(needAssignOrderId) && needAssignOrderId > 0 && (
              <span className="text-amber-700">
                Tip: highlighted order came from “Open Dispatch” and needs
                assignment to a run.
              </span>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium tracking-wide text-slate-700">
              For Dispatch (Delivery)
            </h2>
            <span className="text-[11px] text-slate-500">
              {forDispatch.length} item(s)
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {forDispatch.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">
                Nothing to dispatch right now.
              </div>
            ) : (
              forDispatch.map((r: any) => (
                <div
                  key={r.id}
                  className={`px-4 py-3 hover:bg-slate-50/60 ${
                    Number.isFinite(needAssignOrderId) &&
                    r.id === needAssignOrderId
                      ? "bg-amber-50/60"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={selected.has(r.id)}
                        onChange={(e) => {
                          const on = e.currentTarget.checked;
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <div className="font-mono text-slate-700">
                          {r.orderCode}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          Customer:{" "}
                          <span className="font-medium text-slate-800">
                            {customerLabel(r.customer)}
                          </span>
                          {r.customer?.phone ? (
                            <span className="text-slate-500">
                              {" "}
                              • {r.customer.phone}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Rider: {r.riderName || "—"} • Status:{" "}
                          {r.fulfillmentStatus || "—"}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Printed{" "}
                          {r.printedAt
                            ? new Date(r.printedAt).toLocaleString()
                            : "—"}
                        </div>
                      </div>
                    </div>

                    <Link
                      to={`/orders/${r.id}/dispatch`}
                      className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                      title="Will redirect to run dispatch if already assigned; otherwise returns here for assignment."
                    >
                      Open Dispatch
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
