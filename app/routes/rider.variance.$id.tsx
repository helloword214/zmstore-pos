/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { EmployeeRole, RiderChargeStatus, Prisma } from "@prisma/client";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";

// ------------------------------------------------------------
// Payroll plan tagging (AR list)
// ------------------------------------------------------------
const PLAN_TAG = "PLAN:PAYROLL_DEDUCTION";
const upsertPlanTag = (
  existingNote: string | null | undefined,
  extra: string
) => {
  const base = String(existingNote ?? "").trim();
  const parts: string[] = [];
  if (!base.includes(PLAN_TAG)) parts.push(PLAN_TAG);
  if (base) parts.push(base);
  if (String(extra || "").trim()) parts.push(String(extra).trim());
  return parts.filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
};

type LoaderData = {
  me: {
    userId: number;
    employeeId: number;
    name: string;
    alias: string | null;
    email: string | null;
  };
  v: {
    id: number;
    status: string;
    resolution: string | null;
    createdAt: string;
    expected: number;
    actual: number;
    variance: number;
    note: string | null;
    managerApprovedAt: string | null;
    riderAcceptedAt: string | null;
    run: { id: number; runCode: string };
  };
  canAccept: boolean;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "RIDER_ACCEPTED" || status === "CLOSED") return "success";
  if (status === "MANAGER_APPROVED") return "warning";
  if (status === "WAIVED") return "neutral";
  return "neutral";
}

function resolutionTone(
  resolution: string | null
): "neutral" | "warning" | "danger" | "info" {
  if (resolution === "CHARGE_RIDER") return "danger";
  if (resolution === "WAIVE") return "neutral";
  if (resolution === "INFO_ONLY") return "info";
  return "warning";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["EMPLOYEE"]);
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0)
    throw new Response("Invalid variance id", { status: 400 });

  const userRow = await db.user.findUnique({
    where: { id: (me as any).userId },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });

  const emp = userRow.employee;
  if (!emp) throw new Response("Employee profile not linked", { status: 403 });
  if ((emp.role as EmployeeRole) !== "RIDER")
    throw new Response("Rider access only", { status: 403 });

  const v = await db.riderRunVariance.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      resolution: true,
      createdAt: true,
      expected: true,
      actual: true,
      variance: true,
      note: true,
      managerApprovedAt: true,
      riderAcceptedAt: true,
      riderId: true,
      run: { select: { id: true, runCode: true } },
    },
  });
  if (!v) throw new Response("Variance not found", { status: 404 });
  if (v.riderId !== emp.id) throw new Response("Forbidden", { status: 403 });

  const rawVar = Number(v.variance ?? 0);
  const canAccept =
    String(v.status ?? "") === "MANAGER_APPROVED" &&
    String(v.resolution ?? "") === "CHARGE_RIDER" &&
    !v.riderAcceptedAt &&
    rawVar < 0; // ✅ charge rider accept only for shortages

  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "";

  const data: LoaderData = {
    me: {
      userId: (me as any).userId,
      employeeId: emp.id,
      name: fullName,
      alias: emp.alias ?? null,
      email: userRow.email ?? null,
    },
    v: {
      id: v.id,
      status: String(v.status ?? ""),
      resolution: v.resolution ? String(v.resolution) : null,
      createdAt: v.createdAt.toISOString(),
      expected: r2(Number(v.expected ?? 0)),
      actual: r2(Number(v.actual ?? 0)),
      variance: r2(Number(v.variance ?? 0)),
      note: v.note ?? null,
      managerApprovedAt: v.managerApprovedAt
        ? v.managerApprovedAt.toISOString()
        : null,
      riderAcceptedAt: v.riderAcceptedAt
        ? v.riderAcceptedAt.toISOString()
        : null,
      run: { id: v.run.id, runCode: v.run.runCode },
    },
    canAccept,
  };

  return json(data);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const me = await requireRole(request, ["EMPLOYEE"]);
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0)
    throw new Response("Invalid variance id", { status: 400 });

  const userRow = await db.user.findUnique({
    where: { id: (me as any).userId },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });

  const emp = userRow.employee;
  if (!emp) throw new Response("Employee profile not linked", { status: 403 });
  if ((emp.role as EmployeeRole) !== "RIDER")
    throw new Response("Rider access only", { status: 403 });

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  if (intent !== "accept")
    throw new Response("Unsupported intent", { status: 400 });

  const v = await db.riderRunVariance.findUnique({
    where: { id },
    select: {
      id: true,
      riderId: true,
      status: true,
      resolution: true,
      riderAcceptedAt: true,
      variance: true,
      runId: true,
    },
  });
  if (!v) throw new Response("Variance not found", { status: 404 });
  if (v.riderId !== emp.id) throw new Response("Forbidden", { status: 403 });

  const rawVar = Number(v.variance ?? 0);
  // ✅ Safety: CHARGE_RIDER must be shortage-only
  if (rawVar >= 0) {
    throw new Response("Only shortages can be accepted as rider charges", {
      status: 400,
    });
  }

  // accept only if manager approved + charge rider + not yet accepted
  if (
    String(v.status ?? "") !== "MANAGER_APPROVED" ||
    String(v.resolution ?? "") !== "CHARGE_RIDER" ||
    v.riderAcceptedAt
  ) {
    throw new Response("Variance is not eligible for acceptance", {
      status: 400,
    });
  }

  const now = new Date();
  const riderAcceptedById = Number((me as any).userId) || null;

  await db.$transaction(async (tx) => {
    // 1) variance acceptance
    await tx.riderRunVariance.update({
      where: { id },
      data: {
        status: "RIDER_ACCEPTED" as any,
        riderAcceptedAt: now,
        riderAcceptedById,
      },
    });

    // 2) OPTION B ledger safety:
    // Ensure RiderCharge exists (handles legacy variances created before manager-side upsert patch)
    const amtNum = rawVar < 0 ? Math.abs(rawVar) : 0;
    const amt = new Prisma.Decimal(amtNum.toFixed(2));
    if (amtNum > 0) {
      // Keep any existing note, but ensure payroll plan tag is present.
      // Extra audit note is optional but helpful.
      const extra = "Accepted by rider (payroll deduction plan)";
      await tx.riderCharge.upsert({
        where: { varianceId: v.id },
        create: {
          varianceId: v.id,
          runId: v.runId ?? null,
          riderId: v.riderId,
          amount: amt,
          note: upsertPlanTag(null, extra),
        },
        update: {
          // keep it OPEN; cashier/payroll settlement will move this later
          status: RiderChargeStatus.OPEN,
          note: upsertPlanTag(
            // fetch current note via update query? Prisma upsert update has no "existing" value
            // so we do a safe merge by reading first
            undefined,
            extra
          ),
        },
      });

      // IMPORTANT: Prisma upsert(update) can't access existing note value directly.
      // So we do a follow-up merge update to preserve existing note while ensuring PLAN_TAG.
      const existing = await tx.riderCharge.findUnique({
        where: { varianceId: v.id },
        select: { id: true, note: true },
      });
      if (existing?.id) {
        await tx.riderCharge.update({
          where: { id: existing.id },
          data: { note: upsertPlanTag(existing.note, extra) },
        });
      }
    }
  });

  return redirect("/rider/variances?accepted=1");
}

export default function RiderVarianceDetailPage() {
  const { v, canAccept } = useLoaderData<LoaderData>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title={`Variance #${v.id}`}
        subtitle={`Run ${v.run.runCode} · Status ${v.status}`}
        backTo="/rider/variances"
        backLabel="Variances"
        maxWidthClassName="max-w-3xl"
      />

      <div className="mx-auto max-w-3xl px-5 py-6 space-y-3">
        <SoTCard>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SoTStatusBadge tone={statusTone(v.status)}>{v.status}</SoTStatusBadge>
            {v.resolution ? (
              <SoTStatusBadge tone={resolutionTone(v.resolution)}>
                {v.resolution}
              </SoTStatusBadge>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[11px] text-slate-500">Expected</div>
              <div className="text-lg font-semibold text-slate-900">
                {peso(v.expected)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Actual</div>
              <div className="text-lg font-semibold text-slate-900">
                {peso(v.actual)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Variance</div>
              <div
                className={`text-lg font-semibold ${
                  v.variance < 0 ? "text-rose-700" : "text-emerald-700"
                }`}
              >
                {peso(v.variance)}
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-600 space-y-1">
            <div>
              Manager approved at:{" "}
              <span className="font-medium">
                {v.managerApprovedAt
                  ? new Date(v.managerApprovedAt).toLocaleString()
                  : "—"}
              </span>
            </div>
            <div>
              Rider accepted at:{" "}
              <span className="font-medium">
                {v.riderAcceptedAt
                  ? new Date(v.riderAcceptedAt).toLocaleString()
                  : "—"}
              </span>
            </div>
            <div>
              Note: <span className="font-medium">{v.note ?? "—"}</span>
            </div>
          </div>

          {canAccept ? (
            <SoTAlert tone="warning" className="mt-4">
              <p className="font-semibold">Action required</p>
              <p className="mt-1 text-xs">
                Manager decided to{" "}
                <span className="font-semibold">charge rider</span>. Please
                accept to confirm you acknowledge this variance.
              </p>
              <Form method="post" className="mt-3">
                <SoTButton
                  type="submit"
                  name="_intent"
                  value="accept"
                  variant="primary"
                >
                  Accept variance
                </SoTButton>
              </Form>
            </SoTAlert>
          ) : (
            <SoTAlert tone="info" className="mt-4">
              No action required.
            </SoTAlert>
          )}
        </SoTCard>
      </div>
    </main>
  );
}
