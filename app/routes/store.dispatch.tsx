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
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { Button } from "~/components/ui/Button";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { SelectInput } from "~/components/ui/SelectInput";
import { Prisma } from "@prisma/client";
import {
  ACTIVE_DELIVERY_RUN_STATUSES,
  loadActiveDeliveryRunLinksByOrderIds,
} from "~/services/delivery-run-assignment.server";

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

const isNoReleaseAttemptOutcome = (value: unknown) =>
  value === "NO_RELEASE_REATTEMPT" || value === "NO_RELEASE_CANCELLED";

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

function buildDispatchOrderBy(
  sort: SortKey,
  dir: SortDir
): Prisma.OrderOrderByWithRelationInput[] {
  if (sort === "amount") {
    return [{ totalBeforeDiscount: dir }, { subtotal: dir }, { id: "desc" }];
  }
  if (sort === "printedAt") return [{ printedAt: dir }, { id: "desc" }];
  if (sort === "stagedAt") return [{ stagedAt: dir }, { id: "desc" }];
  return [{ id: dir }];
}

function formatPeso(value: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value || 0));
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

async function loadPendingFailedDeliveryLinks(
  tx: Pick<typeof db, "deliveryRunOrder">,
  orderIds: number[],
) {
  const rows = await tx.deliveryRunOrder.findMany({
    where: {
      orderId: { in: orderIds },
      attemptOutcome: { not: null },
      attemptFinalizedAt: null,
    },
    orderBy: [{ attemptReportedAt: "desc" }, { runId: "desc" }],
    select: {
      runId: true,
      orderId: true,
      attemptOutcome: true,
    },
  });

  const latestByOrderId = new Map<number, { runId: number; orderId: number }>();
  for (const row of rows) {
    const orderId = Number(row.orderId || 0);
    if (!orderId || latestByOrderId.has(orderId)) continue;
    if (!isNoReleaseAttemptOutcome(row.attemptOutcome)) continue;
    latestByOrderId.set(orderId, {
      runId: Number(row.runId),
      orderId,
    });
  }

  return latestByOrderId;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Store manager lane only
  await requireRole(request, ["STORE_MANAGER"]);

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const sort = parseSortKey(url.searchParams.get("sort"));
  const dir = parseSortDir(url.searchParams.get("dir"));
  const take = clampTake(Number(url.searchParams.get("take") || 50), 50);

  // Build orderBy
  const orderBy = buildDispatchOrderBy(sort, dir);

  const forDispatchRows = await db.order.findMany({
    where: {
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: null,
      runOrders: {
        none: {
          run: {
            status: {
              in: [...ACTIVE_DELIVERY_RUN_STATUSES],
            },
          },
        },
      },
      ...(q
        ? {
            OR: [
              {
                orderCode: {
                  contains: q,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                riderName: {
                  contains: q,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                customer: {
                  OR: [
                    {
                      alias: {
                        contains: q,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                    {
                      firstName: {
                        contains: q,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                    {
                      lastName: {
                        contains: q,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                    {
                      phone: {
                        contains: q,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
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
      status: true,
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
      runOrders: {
        where: {
          attemptOutcome: { not: null },
        },
        orderBy: [{ attemptReportedAt: "desc" }, { runId: "desc" }],
        select: {
          runId: true,
          attemptOutcome: true,
          attemptNote: true,
          attemptReportedAt: true,
          attemptFinalizedAt: true,
          run: {
            select: {
              runCode: true,
              status: true,
            },
          },
        },
      },
    },
  });
  const visibleActiveRunLinks = await loadActiveDeliveryRunLinksByOrderIds(
    db,
    forDispatchRows.map((order) => order.id),
  );

  const forDispatch = forDispatchRows
    .filter((order) => !visibleActiveRunLinks.has(order.id))
    .map((order) => {
      const { runOrders, ...orderBase } = order;
      const failedAttempts = (runOrders || []).filter((link) =>
        isNoReleaseAttemptOutcome(link.attemptOutcome),
      );
      const latestFailedAttempt = failedAttempts[0] ?? null;
      const pendingFailedReview = Boolean(
        latestFailedAttempt && !latestFailedAttempt.attemptFinalizedAt,
      );

      return {
        ...orderBase,
        failedAttemptCount: failedAttempts.length,
        latestFailedReason:
          typeof latestFailedAttempt?.attemptNote === "string"
            ? latestFailedAttempt.attemptNote
            : null,
        latestFailedReportedAt: latestFailedAttempt?.attemptReportedAt
          ? new Date(latestFailedAttempt.attemptReportedAt).toISOString()
          : null,
        latestFailedRunCode: latestFailedAttempt?.run?.runCode ?? null,
        pendingFailedReview,
        canCancelFailedReview:
          pendingFailedReview && order.status !== "PARTIALLY_PAID",
      };
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

  return json({ forDispatch, runOptions, q, sort, dir, take });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const managerApprovedById = Number(me.userId) || null;

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
  const baseEligible = await db.order.findMany({
    where: {
      id: { in: orderIds },
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: null,
    },
    select: {
      id: true,
      orderCode: true,
    },
  });
  const eligibleIds = new Set(baseEligible.map((o) => o.id));
  const requestedEligibleIds = orderIds.filter((orderId) => eligibleIds.has(orderId));
  const activeRunLinks = await loadActiveDeliveryRunLinksByOrderIds(
    db,
    requestedEligibleIds,
  );
  const finalIds = requestedEligibleIds.filter(
    (orderId) => !activeRunLinks.has(orderId),
  );
  if (finalIds.length === 0) {
    const hasActiveRunConflict = requestedEligibleIds.some((orderId) =>
      activeRunLinks.has(orderId),
    );
    return json<ActionData>(
      {
        ok: false,
        error: hasActiveRunConflict
          ? "Selected orders are already assigned to another active run."
          : "Selected orders are no longer eligible.",
      },
      { status: hasActiveRunConflict ? 409 : 400 }
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
        skipDuplicates: true,
      });

      const pendingLinks = await loadPendingFailedDeliveryLinks(tx, finalIds);
      for (const orderId of finalIds) {
        const pendingLink = pendingLinks.get(orderId);
        if (!pendingLink) continue;
        await tx.deliveryRunOrder.update({
          where: {
            runId_orderId: {
              runId: pendingLink.runId,
              orderId,
            },
          },
          data: {
            attemptOutcome: "NO_RELEASE_REATTEMPT",
            attemptFinalizedAt: new Date(),
            attemptFinalizedById:
              managerApprovedById && managerApprovedById > 0
                ? managerApprovedById
                : null,
          },
        });
      }
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

    await db.$transaction(async (tx) => {
      await tx.deliveryRunOrder.createMany({
        data: finalIds.map((orderId) => ({ runId, orderId })),
        skipDuplicates: true,
      });

      const pendingLinks = await loadPendingFailedDeliveryLinks(tx, finalIds);
      for (const orderId of finalIds) {
        const pendingLink = pendingLinks.get(orderId);
        if (!pendingLink) continue;
        await tx.deliveryRunOrder.update({
          where: {
            runId_orderId: {
              runId: pendingLink.runId,
              orderId,
            },
          },
          data: {
            attemptOutcome: "NO_RELEASE_REATTEMPT",
            attemptFinalizedAt: new Date(),
            attemptFinalizedById:
              managerApprovedById && managerApprovedById > 0
                ? managerApprovedById
                : null,
          },
        });
      }
    });

    return redirect(`/runs/${runId}/dispatch`);
  }

  if (intent === "cancel-failed-delivery") {
    const targetOrderId = finalIds[0];
    const targetOrder = await db.order.findUnique({
      where: { id: targetOrderId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!targetOrder) {
      return json<ActionData>(
        { ok: false, error: "Order no longer exists." },
        { status: 404 }
      );
    }

    if (targetOrder.status === "PARTIALLY_PAID") {
      return json<ActionData>(
        {
          ok: false,
          error:
            "Partially paid orders need refund/void flow before cancellation.",
        },
        { status: 400 }
      );
    }

    const pendingLinks = await loadPendingFailedDeliveryLinks(db, [targetOrderId]);
    const pendingLink = pendingLinks.get(targetOrderId);
    if (!pendingLink) {
      return json<ActionData>(
        {
          ok: false,
          error: "No pending failed-delivery review found for this order.",
        },
        { status: 400 }
      );
    }

    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: targetOrderId },
        data: {
          status: "CANCELLED",
          fulfillmentStatus: "ON_HOLD",
          dispatchedAt: null,
          deliveredAt: null,
        },
      });

      await tx.deliveryRunOrder.update({
        where: {
          runId_orderId: {
            runId: pendingLink.runId,
            orderId: targetOrderId,
          },
        },
        data: {
          attemptOutcome: "NO_RELEASE_CANCELLED",
          attemptFinalizedAt: new Date(),
          attemptFinalizedById:
            managerApprovedById && managerApprovedById > 0
              ? managerApprovedById
              : null,
        },
      });
    });

    return redirect("/store/dispatch");
  }

  return json<ActionData>(
    { ok: false, error: "Unknown intent." },
    { status: 400 }
  );
}

export default function StoreDispatchQueuePage() {
  const { forDispatch, runOptions, q, sort, dir, take } = useLoaderData<
    typeof loader
  >();
  const actionData = useActionData<ActionData>();
  const [sp] = useSearchParams();
  const needAssignOrderId = Number(sp.get("needAssignOrderId") || NaN);

  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [runId, setRunId] = React.useState<string>("");

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

  const allIds = forDispatch.map((o) => o.id);
  const selectedCount = selected.size;
  const selectedCsv = Array.from(selected).join(",");
  const pendingFailedReviewCount = forDispatch.filter(
    (order) => order.pendingFailedReview,
  ).length;
  const allChecked =
    allIds.length > 0 && allIds.every((id: number) => selected.has(id));
  const selectedFailedReviewCount = forDispatch.filter(
    (o) => selected.has(o.id) && o.pendingFailedReview,
  ).length;

  const toggleSelectedOrder = React.useCallback(
    (orderId: number, force?: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const shouldSelect = force ?? !next.has(orderId);
        if (shouldSelect) next.add(orderId);
        else next.delete(orderId);
        return next;
      });
    },
    [],
  );

  const sortLabel = (k: string) => {
    if (k === "printedAt") return "Printed time";
    if (k === "stagedAt") return "Staged time";
    if (k === "amount") return "Amount";
    return "Newest";
  };

  const customerLabel = (
    c:
      | {
          alias?: string | null;
          firstName?: string | null;
          lastName?: string | null;
        }
      | null
      | undefined,
  ) => {
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
      <SoTNonDashboardHeader
        title="Dispatch Queue"
        subtitle="Delivery orders waiting for run assignment or failed-delivery review."
        maxWidthClassName="max-w-5xl"
      />

      {/* Body */}
      <div className="mx-auto max-w-5xl px-5 py-6">
        <SoTActionBar
          left={
            <div className="text-sm text-slate-600">
              Review staged delivery orders and send them to planned runs.
            </div>
          }
          right={
            <Link to="/runs/new">
              <Button variant="primary">+ New Run</Button>
            </Link>
          }
        />

        <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SoTCard compact>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Visible Queue
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {forDispatch.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Showing up to {take || 50} orders
            </div>
          </SoTCard>
          <SoTCard compact tone={selectedCount > 0 ? "info" : "default"}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Selected
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {selectedCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Ready for assign or create-run
            </div>
          </SoTCard>
          <SoTCard compact tone={runOptions.length > 0 ? "success" : "warning"}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Planned Runs
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {runOptions.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Available for assignment
            </div>
          </SoTCard>
          <SoTCard
            compact
            tone={pendingFailedReviewCount > 0 ? "warning" : "default"}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Re-dispatch Review
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {pendingFailedReviewCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Orders needing re-dispatch or cancel
            </div>
          </SoTCard>
        </div>

        {actionData && !actionData.ok && (
          <SoTAlert tone="danger" className="mb-3">
            {actionData.error}
          </SoTAlert>
        )}

        {/* Search + Sort */}
        <SoTCard compact className="mb-3">
          <Form
            method="get"
            className="grid gap-2 sm:grid-cols-12 sm:items-end"
          >
            <SoTFormField label="Search" className="sm:col-span-6">
              <input
                name="q"
                defaultValue={q || ""}
                placeholder="Order code / customer / phone / rider…"
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Sort" className="sm:col-span-3">
              <SelectInput
                name="sort"
                defaultValue={sort || "id"}
                options={[
                  { label: "Newest", value: "id" },
                  { label: "Printed time", value: "printedAt" },
                  { label: "Staged time", value: "stagedAt" },
                  { label: "Amount", value: "amount" },
                ]}
              />
            </SoTFormField>

            <SoTFormField label="Direction" className="sm:col-span-2">
              <SelectInput
                name="dir"
                defaultValue={dir || "desc"}
                options={[
                  { label: "Desc", value: "desc" },
                  { label: "Asc", value: "asc" },
                ]}
              />
            </SoTFormField>

            <div className="sm:col-span-1">
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
              >
                Apply
              </Button>
            </div>

            {/* keep take stable if user set it */}
            <input type="hidden" name="take" value={String(take || 50)} />
          </Form>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Queue:{" "}
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
                className="rounded-full border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Clear search
              </Link>
            ) : null}
          </div>
        </SoTCard>

        {/* Bulk actions */}
        <SoTCard compact className="mb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <SoTStatusBadge tone={selectedCount > 0 ? "info" : "neutral"}>
                {selectedCount} selected
              </SoTStatusBadge>
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (allChecked) {
                      for (const id of allIds) next.delete(id);
                    } else {
                      for (const id of allIds) next.add(id);
                    }
                    return next;
                  });
                }}
                disabled={allIds.length === 0}
              >
                {allChecked ? "Unselect all" : "Select all"}
              </Button>
              {selectedFailedReviewCount > 0 ? (
                <SoTStatusBadge tone="warning">
                  {selectedFailedReviewCount} re-dispatch review
                </SoTStatusBadge>
              ) : null}
            </div>

            <Form
              method="post"
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input type="hidden" name="orderIds" value={selectedCsv} />

              <div className="flex items-center gap-2">
                <SelectInput
                  name="runId"
                  value={runId}
                  onChange={(value) => setRunId(String(value))}
                  className="w-56"
                  options={[
                    { label: "— Assign to PLANNED run —", value: "" },
                    ...runOptions.map((r) => ({
                      label: r.label,
                      value: String(r.id),
                    })),
                  ]}
                />

                <Button
                  type="submit"
                  name="intent"
                  value="assign-run"
                  variant="primary"
                  disabled={selectedCount === 0 || !runId}
                  title={
                    !runId
                      ? "Choose a PLANNED run"
                      : "Assign selected orders to this run"
                  }
                >
                  {selectedFailedReviewCount > 0 ? "Re-dispatch to Run" : "Assign"}
                </Button>

                <Button
                  type="submit"
                  name="intent"
                  value="create-run"
                  variant="secondary"
                  disabled={selectedCount === 0}
                  title="Create a new run from the selected orders"
                >
                  {selectedFailedReviewCount > 0 ? "Create Re-dispatch Run" : "Create Run"}
                </Button>
              </div>
            </Form>
          </div>

          {selectedFailedReviewCount > 0 ? (
            <SoTAlert tone="warning" className="mt-3">
              Assigning or creating a run will finalize{" "}
              {selectedFailedReviewCount} failed-delivery{" "}
              {selectedFailedReviewCount > 1 ? "reports" : "report"} as ready
              for dispatch again.
            </SoTAlert>
          ) : null}

          {Number.isFinite(needAssignOrderId) && needAssignOrderId > 0 ? (
            <SoTAlert tone="info" className="mt-3">
              Highlighted order returned from dispatch detail and is ready for
              run assignment.
            </SoTAlert>
          ) : null}
        </SoTCard>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium tracking-wide text-slate-700">
              Dispatch Inbox
            </h2>
            <span className="text-[11px] text-slate-500">
              {forDispatch.length} item(s)
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {forDispatch.length === 0 ? (
              <SoTEmptyState
                title="Nothing to dispatch right now."
                hint="New delivery orders will appear here once staged."
              />
            ) : (
              forDispatch.map((r) => (
                <div
                  key={r.id}
                  className={`px-4 py-3 hover:bg-slate-50/60 ${
                    Number.isFinite(needAssignOrderId) &&
                    r.id === needAssignOrderId
                      ? "bg-amber-50/60"
                      : ""
                  }`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-mono text-sm text-slate-700">
                            {r.orderCode}
                          </div>
                          <SoTStatusBadge tone="neutral">
                            {r.fulfillmentStatus || "—"}
                          </SoTStatusBadge>
                          {r.failedAttemptCount > 0 ? (
                            <SoTStatusBadge
                              tone={r.pendingFailedReview ? "warning" : "neutral"}
                            >
                              {r.pendingFailedReview
                                ? "Failed review"
                                : "Failed history"}
                            </SoTStatusBadge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {customerLabel(r.customer)}
                          {r.customer?.phone ? (
                            <span className="font-normal text-slate-500">
                              {" "}
                              • {r.customer.phone}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>Rider: {r.riderName || "—"}</span>
                          <span>Printed {formatDateTime(r.printedAt)}</span>
                          <span className="font-medium text-slate-700">
                            {formatPeso(r.totalBeforeDiscount ?? r.subtotal)}
                          </span>
                        </div>
                        {r.failedAttemptCount > 0 ? (
                          <SoTAlert
                            tone={r.pendingFailedReview ? "warning" : "info"}
                            className="mt-2"
                            title={
                              r.pendingFailedReview
                                ? "Failed delivery review"
                                : "Failed delivery history"
                            }
                          >
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              <span>
                                Attempts:{" "}
                                <span className="font-semibold">
                                  {r.failedAttemptCount}
                                </span>
                              </span>
                              {r.latestFailedRunCode ? (
                                <span>Last run: {r.latestFailedRunCode}</span>
                              ) : null}
                              {r.latestFailedReportedAt ? (
                                <span>
                                  Reported {formatDateTime(r.latestFailedReportedAt)}
                                </span>
                              ) : null}
                            </div>
                            {r.latestFailedReason ? (
                              <div className="mt-1">
                                Rider reason: {r.latestFailedReason}
                              </div>
                            ) : null}
                            {r.pendingFailedReview ? (
                              <div className="mt-1">
                                Choose re-dispatch or cancel here.
                              </div>
                            ) : null}
                          </SoTAlert>
                        ) : null}
                      </div>
                    </div>

                    {r.failedAttemptCount > 0 ? (
                      <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                        <Button
                          type="button"
                          variant={
                            selected.has(r.id) ? "secondary" : "primary"
                          }
                          onClick={() =>
                            toggleSelectedOrder(r.id, !selected.has(r.id))
                          }
                        >
                          {selected.has(r.id)
                            ? "Selected for Re-dispatch"
                            : "Select Re-dispatch"}
                        </Button>
                        {r.pendingFailedReview ? (
                          <Form method="post" className="flex flex-col items-start gap-1 lg:items-end">
                            <input type="hidden" name="orderIds" value={String(r.id)} />
                            <Button
                              type="submit"
                              name="intent"
                              value="cancel-failed-delivery"
                              variant="tertiary"
                              disabled={!r.canCancelFailedReview}
                              title={
                                r.canCancelFailedReview
                                  ? "Cancel this failed delivery order from the queue"
                                  : "Partially paid orders need refund/void before cancellation."
                              }
                            >
                              Cancel order
                            </Button>
                            {!r.canCancelFailedReview ? (
                              <span className="text-[11px] text-slate-500">
                                Refund/void required first.
                              </span>
                            ) : null}
                          </Form>
                        ) : null}
                      </div>
                    ) : (
                      <Link
                        to={`/orders/${r.id}/dispatch`}
                        className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        title="Open dispatch detail"
                      >
                        Open Dispatch
                      </Link>
                    )}
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
