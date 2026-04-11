import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import type { Prisma, RunStatus } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

const MANAGER_INBOX_STATUSES: RunStatus[] = ["PLANNED", "DISPATCHED", "CHECKED_IN"];
const RIDER_INBOX_STATUSES: RunStatus[] = ["DISPATCHED", "CHECKED_IN"];
const TERMINAL_RUN_STATUSES: RunStatus[] = ["CLOSED", "CANCELLED"];
const RUNS_PAGE_SIZE = 25;

type Row = {
  id: number;
  runCode: string;
  status: RunStatus;
  riderLabel: string | null;
  createdAt: string;
  dispatchedAt: string | null;
};

type LoaderData = {
  rows: Row[];
  nextCursor: number | null;
  history: boolean;
  mine: boolean;
  role: string;
};

function RunsModePendingLayer({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-[2px]">
      <div className="flex h-full flex-col justify-center px-4 py-6">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700">
          <span
            aria-hidden="true"
            className="inline-flex h-2 w-2 animate-pulse rounded-full bg-indigo-500"
          />
          <span>{label}</span>
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`runs-pending-row-${index}`}
              aria-hidden="true"
              className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-slate-100/85"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["ADMIN", "STORE_MANAGER", "EMPLOYEE"]);

  const url = new URL(request.url);
  const cursorParam = Number(url.searchParams.get("cursor"));
  const cursor =
    Number.isInteger(cursorParam) && cursorParam > 0 ? cursorParam : null;
  const history = url.searchParams.get("history") === "1";
  let mine = url.searchParams.get("mine") === "1";

  // 🔒 Rider (EMPLOYEE) can ONLY use /runs?mine=1
  if (me.role === "EMPLOYEE") {
    if (!mine) {
      url.searchParams.set("mine", "1");
      throw redirect(url.toString());
    }
    mine = true;
  }

  const scopeWhere: Prisma.DeliveryRunWhereInput = {};

  // If EMPLOYEE at galing sa /runs?mine=1 => filter by assigned rider (employee)
  if (me.role === "EMPLOYEE" && mine) {
    const userRow = await db.user.findUnique({
      where: { id: me.userId },
      select: {
        employee: {
          select: { id: true },
        },
      },
    });

    const riderId = userRow?.employee?.id ?? null;

    if (riderId) {
      scopeWhere.riderId = riderId;
    } else {
      // walang naka-link na employee → wala siyang runs
      return json<LoaderData>({
        rows: [],
        nextCursor: null,
        history,
        mine,
        role: me.role,
      });
    }
  }

  const inboxStatuses =
    me.role === "EMPLOYEE" ? RIDER_INBOX_STATUSES : MANAGER_INBOX_STATUSES;
  const listStatuses = history ? TERMINAL_RUN_STATUSES : inboxStatuses;
  const listWhere: Prisma.DeliveryRunWhereInput = {
    ...scopeWhere,
    status: { in: listStatuses },
    ...(cursor ? { id: { gte: cursor } } : {}),
  };
  const runs = await db.deliveryRun.findMany({
    where: listWhere,
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      createdAt: true,
      dispatchedAt: true,
    },
    orderBy: { id: "desc" },
    take: cursor ? undefined : RUNS_PAGE_SIZE,
  });

  const riderIds = Array.from(
    new Set(runs.map((r) => r.riderId).filter(Boolean))
  ) as number[];
  const riders = riderIds.length
    ? await db.employee.findMany({
        where: { id: { in: riderIds } },
        select: { id: true, firstName: true, lastName: true, alias: true },
      })
    : [];
  const map = new Map<number, string>();
  for (const r of riders) {
    const label = (r.alias?.trim() ||
      [r.firstName, r.lastName].filter(Boolean).join(" ") ||
      `#${r.id}`)!;
    map.set(r.id, label);
  }
  const rows: Row[] = runs.map((r) => ({
    id: r.id,
    runCode: r.runCode,
    status: r.status,
    riderLabel: r.riderId ? map.get(r.riderId) ?? null : null,
    createdAt: r.createdAt.toISOString(),
    dispatchedAt: r.dispatchedAt ? r.dispatchedAt.toISOString() : null,
  }));

  const currentOldestId = rows.at(-1)?.id ?? null;
  const nextChunk =
    currentOldestId == null
      ? []
      : await db.deliveryRun.findMany({
          where: {
            ...scopeWhere,
            status: { in: listStatuses },
            id: { lt: currentOldestId },
          },
          select: { id: true },
          orderBy: { id: "desc" },
          take: RUNS_PAGE_SIZE,
        });
  const nextCursor = nextChunk.length > 0 ? nextChunk.at(-1)?.id ?? null : null;

  return json<LoaderData>({ rows, nextCursor, history, mine, role: me.role });
}

export default function RunsIndexPage() {
  const { rows, nextCursor, history, mine, role } = useLoaderData<LoaderData>();
  const navigation = useNavigation();

  const backHref = role === "EMPLOYEE" ? "/rider" : "/store";
  const backLabel = "Dashboard";
  const pageTitle = "Runs";
  const pageSubtitle = "Open the next step for each run.";
  const emptyMessage = history
    ? "No terminal runs yet."
    : "No actionable runs right now.";
  const statusTone = (
    status: Row["status"],
  ): "neutral" | "info" | "success" | "warning" | "danger" => {
    if (status === "CLOSED") return "success";
    if (status === "CHECKED_IN") return "info";
    if (status === "DISPATCHED" || status === "PLANNED") return "warning";
    if (status === "CANCELLED") return "danger";
    return "neutral";
  };
  const nextStepLabel = (r: Row) => {
    if (mine && role === "EMPLOYEE") {
      return r.status === "DISPATCHED" ? "Check-in next" : "Summary";
    }
    if (r.status === "PLANNED") return "Dispatch staging";
    if (r.status === "DISPATCHED") return "Awaiting check-in";
    if (r.status === "CHECKED_IN") return "Manager remit";
    return "Summary";
  };
  const nextActionLabel = (r: Row) => {
    if (mine && role === "EMPLOYEE") {
      return r.status === "DISPATCHED" ? "Open Check-in" : "Open Summary";
    }
    if (r.status === "PLANNED") return "Open Dispatch";
    if (r.status === "DISPATCHED") return "Track Check-in";
    if (r.status === "CHECKED_IN") return "Open Remit";
    return "Open Summary";
  };

  const nextHref = (r: Row) => {
    // Rider view: /runs?mine=1 and role = EMPLOYEE
    if (mine && role === "EMPLOYEE") {
      if (r.status === "DISPATCHED") {
        // dito papasok yung bagong rider-checkin page
        return `/runs/${r.id}/rider-checkin`;
      }
      // CLOSED / CANCELLED / others → summary lang
      return `/runs/${r.id}/summary`;
    }

    if (r.status === "PLANNED") return `/runs/${r.id}/dispatch`;
    // DISPATCHED: waiting for rider check-in (manager view-only here)
    if (r.status === "DISPATCHED") return `/runs/${r.id}/summary`;
    // CHECK_IN: tapos na si rider, manager magre-remit/approve/close
    if (r.status === "CHECKED_IN") return `/runs/${r.id}/remit`;
    // CLOSED / CANCELLED: read-only summary
    return `/runs/${r.id}/summary`;
  };
  const buildModeHref = (nextHistory: boolean) => {
    const params = new URLSearchParams();
    if (mine) {
      params.set("mine", "1");
    }
    if (nextHistory) {
      params.set("history", "1");
    }
    const query = params.toString();
    return query ? `/runs?${query}` : "/runs";
  };
  const buildLoadMoreHref = () => {
    if (!nextCursor) {
      return null;
    }
    const params = new URLSearchParams();
    if (mine) {
      params.set("mine", "1");
    }
    if (history) {
      params.set("history", "1");
    }
    params.set("cursor", String(nextCursor));
    return `/runs?${params.toString()}`;
  };
  const loadMoreHref = buildLoadMoreHref();
  const pendingHistorySearch = navigation.location?.search ?? "";
  const pendingHistoryValue = new URLSearchParams(pendingHistorySearch).get("history") === "1";
  const pendingMineValue = new URLSearchParams(pendingHistorySearch).get("mine") === "1";
  const modeSwitchPending =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/runs" &&
    pendingMineValue === mine &&
    pendingHistoryValue !== history;
  const pendingModeLabel = pendingHistoryValue ? "Loading history" : "Loading inbox";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        backTo={backHref}
        backLabel={backLabel}
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto max-w-5xl space-y-3 p-5">
        <SoTActionBar
          left={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={buildModeHref(false)}
                prefetch="intent"
                preventScrollReset
              >
                <SoTButton
                  variant={history ? "secondary" : "primary"}
                  size="compact"
                >
                  Inbox
                  {modeSwitchPending && !pendingHistoryValue ? (
                    <span
                      aria-hidden="true"
                      className="ml-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-current/70"
                    />
                  ) : null}
                </SoTButton>
              </Link>
              <Link
                to={buildModeHref(true)}
                prefetch="intent"
                preventScrollReset
              >
                <SoTButton
                  variant={history ? "primary" : "secondary"}
                  size="compact"
                >
                  History
                  {modeSwitchPending && pendingHistoryValue ? (
                    <span
                      aria-hidden="true"
                      className="ml-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-current/70"
                    />
                  ) : null}
                </SoTButton>
              </Link>
            </div>
          }
        />

        <div className="relative min-h-[24rem] lg:min-h-[30rem]">
          <div
            className={`space-y-3 transition-opacity duration-150 ${
              modeSwitchPending ? "pointer-events-none opacity-0" : "opacity-100"
            }`.trim()}
          >
            <div className="space-y-3 lg:hidden">
              {rows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-sm">
                  {emptyMessage}
                </div>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {r.runCode}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">Run #{r.id}</div>
                      </div>
                      <SoTStatusBadge tone={statusTone(r.status)}>{r.status}</SoTStatusBadge>
                    </div>

                    <div className="mt-4 space-y-2 text-sm">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Rider
                        </div>
                        <div className="mt-1 font-medium text-slate-900">
                          {r.riderLabel ?? "Unassigned"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {r.dispatchedAt
                            ? `Dispatched ${new Date(r.dispatchedAt).toLocaleString()}`
                            : "Not dispatched yet"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Created
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
                        Next Action
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {nextStepLabel(r)}
                      </div>
                      <div className="mt-3">
                        <Link
                          to={nextHref(r)}
                          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
                        >
                          {nextActionLabel(r)}
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
              <SoTTable>
                <SoTTableHead>
                  <tr>
                    <SoTTh>Run</SoTTh>
                    <SoTTh>Rider</SoTTh>
                    <SoTTh>Status</SoTTh>
                    <SoTTh>Created</SoTTh>
                    <SoTTh>Next Step</SoTTh>
                    <SoTTh align="right"></SoTTh>
                  </tr>
                </SoTTableHead>
                <tbody>
                  {rows.length === 0 ? (
                    <SoTTableEmptyRow colSpan={6} message={emptyMessage} />
                  ) : (
                    rows.map((r) => (
                      <SoTTableRow key={r.id}>
                        <SoTTd>
                          <div className="font-mono text-slate-900">{r.runCode}</div>
                          <div className="text-[11px] text-slate-500">Run #{r.id}</div>
                        </SoTTd>
                        <SoTTd>
                          <div className="text-slate-900">{r.riderLabel ?? "Unassigned"}</div>
                          <div className="text-[11px] text-slate-500">
                            {r.dispatchedAt
                              ? `Dispatched ${new Date(r.dispatchedAt).toLocaleString()}`
                              : "Not dispatched yet"}
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <SoTStatusBadge tone={statusTone(r.status)}>{r.status}</SoTStatusBadge>
                        </SoTTd>
                        <SoTTd className="text-slate-500">
                          {new Date(r.createdAt).toLocaleString()}
                        </SoTTd>
                        <SoTTd className="font-medium text-slate-700">
                          {nextStepLabel(r)}
                        </SoTTd>
                        <SoTTd align="right">
                          <Link
                            to={nextHref(r)}
                            className="font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                          >
                            {nextActionLabel(r)}
                          </Link>
                        </SoTTd>
                      </SoTTableRow>
                    ))
                  )}
                </tbody>
              </SoTTable>
            </div>

            {loadMoreHref ? (
              <div className="flex justify-center pt-1">
                <Link to={loadMoreHref}>
                  <SoTButton variant="secondary">Load More</SoTButton>
                </Link>
              </div>
            ) : null}
          </div>

          {modeSwitchPending ? <RunsModePendingLayer label={pendingModeLabel} /> : null}
        </div>
      </div>
    </main>
  );
}
