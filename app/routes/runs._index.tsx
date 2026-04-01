import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
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
  mine: boolean;
  role: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Store manager / admin / cashier / rider all allowed
  const me = await requireRole(request, ["ADMIN", "STORE_MANAGER", "EMPLOYEE"]);

  const url = new URL(request.url);
  let mine = url.searchParams.get("mine") === "1";

  // 🔒 Rider (EMPLOYEE) can ONLY use /runs?mine=1
  if (me.role === "EMPLOYEE") {
    if (!mine) {
      url.searchParams.set("mine", "1");
      throw redirect(url.toString());
    }
    mine = true;
  }

  // base where
  const where: Prisma.DeliveryRunWhereInput = {};
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
      where.riderId = riderId;
      // Rider view: dispatched / checked-in / closed runs
      where.status = { in: ["DISPATCHED", "CHECKED_IN", "CLOSED"] };
    } else {
      // walang naka-link na employee → wala siyang runs
      return json<LoaderData>({ rows: [], mine, role: me.role });
    }
  }

  const runs = await db.deliveryRun.findMany({
    where,
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      createdAt: true,
      dispatchedAt: true,
    },
    orderBy: { id: "desc" },
    take: 50,
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
  return json<LoaderData>({ rows, mine, role: me.role });
}

export default function RunsIndexPage() {
  const { rows, mine, role } = useLoaderData<LoaderData>();
  const plannedCount = rows.filter((row) => row.status === "PLANNED").length;
  const activeCount = rows.filter(
    (row) => row.status === "DISPATCHED" || row.status === "CHECKED_IN",
  ).length;
  const closedCount = rows.filter((row) => row.status === "CLOSED").length;

  const backHref = role === "EMPLOYEE" ? "/rider" : "/store";
  const backLabel = "Dashboard";
  const pageTitle = mine && role === "EMPLOYEE" ? "My Delivery Runs" : "Runs";
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

    // Manager / Admin / Cashier view – new flow
    if (r.status === "PLANNED") return `/runs/${r.id}/dispatch`;
    // DISPATCHED: waiting for rider check-in (manager view-only here)
    if (r.status === "DISPATCHED") return `/runs/${r.id}/summary`;
    // CHECK_IN: tapos na si rider, manager magre-remit/approve/close
    if (r.status === "CHECKED_IN") return `/runs/${r.id}/remit`;
    // CLOSED / CANCELLED: read-only summary
    return `/runs/${r.id}/summary`;
  };

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title={pageTitle}
        subtitle="Open the next step for each run."
        backTo={backHref}
        backLabel={backLabel}
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto max-w-5xl space-y-3 p-5">
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Total <span className="font-semibold text-slate-900">{rows.length}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Planned <span className="font-semibold text-slate-900">{plannedCount}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Active <span className="font-semibold text-slate-900">{activeCount}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Closed <span className="font-semibold text-slate-900">{closedCount}</span>
          </span>
        </div>
        <SoTActionBar
          left={<p className="text-xs text-slate-500">Choose the next step from each row.</p>}
          right={
            !mine && role !== "EMPLOYEE" ? (
              <Link to="/runs/new">
                <SoTButton variant="primary">+ New Run</SoTButton>
              </Link>
            ) : null
          }
        />

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                <SoTTableEmptyRow colSpan={6} message="No runs yet." />
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
                    <SoTTd className="text-slate-500">
                      {nextStepLabel(r)}
                    </SoTTd>
                    <SoTTd align="right">
                      <Link
                        to={nextHref(r)}
                        className="text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                      >
                        Open Run
                      </Link>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </div>
      </div>
    </main>
  );
}
