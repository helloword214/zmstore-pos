/* app/routes/rider.variances.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import type { EmployeeRole } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
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

type LoaderData = {
  user: { name: string; alias: string | null; email: string | null };
  pending: Array<{
    id: number;
    createdAt: string;
    expected: number;
    actual: number;
    variance: number;
    note: string | null;
    run: { id: number; runCode: string };
  }>;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["EMPLOYEE"]);

  const uid = Number((me as any).userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Response("Invalid user session", { status: 401 });
  }

  const userRow = await db.user.findUnique({
    where: { id: uid },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });

  const emp = userRow.employee;
  if (!emp) throw new Response("Employee profile not linked", { status: 403 });
  if ((emp.role as EmployeeRole) !== "RIDER")
    throw new Response("Rider access only", { status: 403 });

  const pending = await db.riderRunVariance.findMany({
    where: {
      riderId: emp.id,
      status: "MANAGER_APPROVED",
      resolution: "CHARGE_RIDER",
      riderAcceptedAt: null,
      // ✅ Charge rider accept list must be shortage-only
      variance: { lt: 0 },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expected: true,
      actual: true,
      variance: true,
      note: true,
      run: { select: { id: true, runCode: true } },
    },
  });

  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "";

  return json<LoaderData>({
    user: {
      name: fullName,
      alias: emp.alias ?? null,
      email: userRow.email ?? null,
    },
    pending: pending.map((v) => ({
      id: v.id,
      createdAt: v.createdAt.toISOString(),
      expected: r2(Number(v.expected ?? 0)),
      actual: r2(Number(v.actual ?? 0)),
      variance: r2(Number(v.variance ?? 0)),
      note: v.note ?? null,
      run: { id: v.run.id, runCode: v.run.runCode },
    })),
  });
}

export default function RiderVariancesListPage() {
  const { pending } = useLoaderData<LoaderData>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Pending Variances"
        subtitle="Review and accept manager-tagged rider variances."
        backTo="/rider"
        backLabel="Dashboard"
      />

      <div className="mx-auto max-w-6xl px-5 py-6">
        <SoTCard className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <SoTActionBar
              className="mb-0"
              left={
                <div className="text-sm font-medium text-slate-800">
                  Needs your acceptance (Charge rider)
                </div>
              }
              right={
                <div className="text-xs text-slate-500">
                  {pending.length} item(s)
                </div>
              }
            />
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow className="border-t-0">
                <SoTTh>Run</SoTTh>
                <SoTTh align="right">Variance</SoTTh>
                <SoTTh>Note</SoTTh>
                <SoTTh align="right">Action</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {pending.length === 0 ? (
                <SoTTableEmptyRow
                  colSpan={4}
                  message={
                    <SoTEmptyState
                      title="No pending acceptances."
                      hint="New charge acceptance requests will appear here."
                    />
                  }
                />
              ) : (
                pending.map((v) => (
                  <SoTTableRow key={v.id}>
                    <SoTTd>
                      <div className="font-mono text-slate-800">{v.run.runCode}</div>
                      <div className="text-[11px] text-slate-500">ref #{v.id}</div>
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      <span className="text-rose-700">{peso(Math.abs(v.variance))}</span>
                      <div className="mt-1 flex justify-end">
                        <SoTStatusBadge tone="danger">SHORT</SoTStatusBadge>
                      </div>
                    </SoTTd>
                    <SoTTd className="text-xs text-slate-600">{v.note ?? "—"}</SoTTd>
                    <SoTTd align="right">
                      <Link to={`/rider/variance/${v.id}`}>
                        <SoTButton variant="primary" className="text-sm">
                          Open
                        </SoTButton>
                      </Link>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </SoTCard>
      </div>
    </main>
  );
}
