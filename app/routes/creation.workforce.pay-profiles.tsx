import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { EmployeePayBasis } from "@prisma/client";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
import { SoTTextarea } from "~/components/ui/SoTTextarea";
import { SelectInput } from "~/components/ui/SelectInput";
import {
  listEmployeePayProfiles,
  upsertEmployeePayProfile,
} from "~/services/worker-payroll-policy.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function formatDateInput(value: Date | string) {
  const date = toDateOnly(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(value: Date | string) {
  return toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function actorLabel(actor: {
  email: string | null;
  employee: { firstName: string; lastName: string; alias: string | null } | null;
} | null) {
  if (!actor) return "Unknown actor";
  if (actor.employee) {
    const fullName =
      `${actor.employee.firstName} ${actor.employee.lastName}`.trim();
    return actor.employee.alias
      ? `${actor.employee.alias} (${fullName})`
      : fullName;
  }
  return actor.email ?? "Unknown actor";
}

function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
}

function peso(value: number | null) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const selectedEmployeeId = parseOptionalInt(url.searchParams.get("employeeId"));
  const selectedProfileId = parseOptionalInt(url.searchParams.get("profileId"));
  const saved = url.searchParams.get("saved");

  const workersRaw = await db.employee.findMany({
    where: {
      active: true,
      user: { is: { active: true } },
    },
    include: {
      user: {
        select: { role: true },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const activeWorker =
    workersRaw.find((worker) => worker.id === selectedEmployeeId) ??
    workersRaw[0] ??
    null;

  const profilesRaw = await listEmployeePayProfiles(
    activeWorker ? { employeeId: activeWorker.id } : undefined,
  );
  const profiles = profilesRaw.map((profile) => ({
    id: profile.id,
    employeeId: profile.employeeId,
    employeeLabel: buildWorkerLabel(profile.employee),
    employeeRole: profile.employee.user?.role ?? "UNASSIGNED",
    payBasis: profile.payBasis,
    baseDailyRate:
      profile.baseDailyRate == null ? null : Number(profile.baseDailyRate),
    baseMonthlyRate:
      profile.baseMonthlyRate == null ? null : Number(profile.baseMonthlyRate),
    dailyRateEquivalent: Number(profile.dailyRateEquivalent),
    halfDayFactor: Number(profile.halfDayFactor),
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    note: profile.note ?? null,
    createdByLabel: actorLabel(profile.createdBy),
    updatedByLabel: actorLabel(profile.updatedBy),
  }));

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ??
    profiles[0] ??
    null;

  return json({
    workers: workersRaw.map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
    })),
    activeWorkerId: activeWorker?.id ?? null,
    profiles,
    selectedProfile,
    saved,
    today: formatDateInput(new Date()),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent !== "save-profile") {
      return json<ActionData>(
        { ok: false, error: "Unsupported action.", action: intent },
        { status: 400 },
      );
    }

    const profileId = parseOptionalInt(String(fd.get("profileId") || ""));
    const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
    const payBasis = String(fd.get("payBasis") || "");
    if (!employeeId) throw new Error("Employee is required.");
    if (payBasis !== EmployeePayBasis.DAILY && payBasis !== EmployeePayBasis.MONTHLY) {
      throw new Error("Invalid pay basis.");
    }

    const profile = await upsertEmployeePayProfile({
      id: profileId ?? undefined,
      employeeId,
      payBasis,
      baseDailyRate:
        String(fd.get("baseDailyRate") || "").trim().length > 0
          ? Number(fd.get("baseDailyRate"))
          : null,
      baseMonthlyRate:
        String(fd.get("baseMonthlyRate") || "").trim().length > 0
          ? Number(fd.get("baseMonthlyRate"))
          : null,
      dailyRateEquivalent: Number(fd.get("dailyRateEquivalent") || 0),
      halfDayFactor:
        String(fd.get("halfDayFactor") || "").trim().length > 0
          ? Number(fd.get("halfDayFactor"))
          : 0.5,
      effectiveFrom: String(fd.get("effectiveFrom") || ""),
      effectiveTo:
        String(fd.get("effectiveTo") || "").trim().length > 0
          ? String(fd.get("effectiveTo"))
          : null,
      note: String(fd.get("note") || ""),
      actorUserId: me.userId,
    });

    return redirect(
      `/creation/workforce/pay-profiles?employeeId=${profile.employeeId}&profileId=${profile.id}&saved=profile`,
    );
  } catch (error) {
    return json<ActionData>(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save pay profile.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function PayProfilesCreationRoute() {
  const { workers, activeWorkerId, profiles, selectedProfile, saved, today } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Employee Pay Profiles"
        subtitle="Admin-owned effective-dated pay basis and rate history used by attendance snapshots and payroll runs."
        backTo="/"
        backLabel="Admin Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved === "profile" ? (
          <SoTAlert tone="success">Employee pay profile saved.</SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="form" className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Worker focus
              </h2>
              <p className="text-xs text-slate-500">
                Choose one employee to manage effective-dated payroll rates.
              </p>
            </div>
            <Link
              to="/creation/workforce/payroll-policy"
              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Payroll policy
            </Link>
          </div>

          <Form method="get" className="grid gap-3 md:grid-cols-[1fr,auto]">
            <SoTFormField label="Employee">
              <SelectInput
                name="employeeId"
                defaultValue={activeWorkerId ?? ""}
                options={workers.map((worker) => ({
                  value: worker.id,
                  label: `${worker.label} · ${worker.role}`,
                }))}
              />
            </SoTFormField>
            <div className="flex items-end">
              <SoTButton type="submit" variant="primary">
                Load employee
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <SoTCard interaction="form" className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Pay profile form
                </h2>
                <p className="text-xs text-slate-500">
                  Daily and monthly workers can both use day-based payroll V1 by
                  storing a daily-rate equivalent.
                </p>
              </div>

              <Form method="post" className="space-y-3">
                <input type="hidden" name="_intent" value="save-profile" />
                <input type="hidden" name="profileId" value={selectedProfile?.id ?? ""} />
                <input type="hidden" name="employeeId" value={activeWorkerId ?? ""} />

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Pay basis">
                    <SelectInput
                      name="payBasis"
                      defaultValue={
                        selectedProfile?.payBasis ?? EmployeePayBasis.DAILY
                      }
                      options={[
                        { value: EmployeePayBasis.DAILY, label: "Daily" },
                        { value: EmployeePayBasis.MONTHLY, label: "Monthly" },
                      ]}
                    />
                  </SoTFormField>
                  <SoTFormField label="Daily rate equivalent">
                    <SoTInput
                      name="dailyRateEquivalent"
                      inputMode="decimal"
                      defaultValue={selectedProfile?.dailyRateEquivalent ?? ""}
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Base daily rate">
                    <SoTInput
                      name="baseDailyRate"
                      inputMode="decimal"
                      defaultValue={selectedProfile?.baseDailyRate ?? ""}
                      placeholder="Required for daily basis"
                    />
                  </SoTFormField>
                  <SoTFormField label="Base monthly rate">
                    <SoTInput
                      name="baseMonthlyRate"
                      inputMode="decimal"
                      defaultValue={selectedProfile?.baseMonthlyRate ?? ""}
                      placeholder="Required for monthly basis"
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <SoTFormField label="Half-day factor">
                    <SoTInput
                      name="halfDayFactor"
                      inputMode="decimal"
                      defaultValue={selectedProfile?.halfDayFactor ?? 0.5}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={
                        selectedProfile?.effectiveFrom
                          ? formatDateInput(selectedProfile.effectiveFrom)
                          : today
                      }
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Effective to">
                    <SoTInput
                      type="date"
                      name="effectiveTo"
                      defaultValue={
                        selectedProfile?.effectiveTo
                          ? formatDateInput(selectedProfile.effectiveTo)
                          : ""
                      }
                    />
                  </SoTFormField>
                </div>

                <SoTTextarea
                  name="note"
                  label="Profile note"
                  rows={3}
                  defaultValue={selectedProfile?.note ?? ""}
                  placeholder="Explain rate change or onboarding context"
                />

                <SoTButton type="submit" variant="primary" disabled={!activeWorkerId}>
                  Save pay profile
                </SoTButton>
              </Form>
            </SoTCard>
          </section>

          <aside className="space-y-5 lg:col-span-5">
            <SoTCard className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Profile history
                </h2>
                <p className="text-xs text-slate-500">
                  Keep earlier rates for audit and attendance-time snapshot safety.
                </p>
              </div>

              <SoTTable>
                <SoTTableHead>
                  <SoTTableRow>
                    <SoTTh>Effective</SoTTh>
                    <SoTTh>Rates</SoTTh>
                    <SoTTh>Action</SoTTh>
                  </SoTTableRow>
                </SoTTableHead>
                <tbody>
                  {profiles.length === 0 ? (
                    <SoTTableEmptyRow
                      colSpan={3}
                      message="No pay profiles for the selected employee yet."
                    />
                  ) : (
                    profiles.map((profile) => (
                      <SoTTableRow key={profile.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {formatDateLabel(profile.effectiveFrom)}
                            </div>
                            <div className="text-xs text-slate-500">
                              to{" "}
                              {profile.effectiveTo
                                ? formatDateLabel(profile.effectiveTo)
                                : "open-ended"}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <div className="space-y-1 text-xs text-slate-600">
                            <div>{profile.payBasis}</div>
                            <div>Daily eq. {peso(profile.dailyRateEquivalent)}</div>
                            <div>
                              Daily {peso(profile.baseDailyRate)} · Monthly{" "}
                              {peso(profile.baseMonthlyRate)}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <Link
                            to={`/creation/workforce/pay-profiles?employeeId=${profile.employeeId}&profileId=${profile.id}`}
                            className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                              selectedProfile?.id === profile.id
                                ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                                : "border-slate-300 bg-white text-slate-700"
                            }`}
                          >
                            {selectedProfile?.id === profile.id ? "Selected" : "Open"}
                          </Link>
                        </SoTTd>
                      </SoTTableRow>
                    ))
                  )}
                </tbody>
              </SoTTable>
            </SoTCard>

            {selectedProfile ? (
              <SoTCard className="space-y-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Selected profile summary
                </h2>
                <div className="space-y-1 text-sm text-slate-700">
                  <div>{selectedProfile.employeeLabel}</div>
                  <div>{selectedProfile.employeeRole}</div>
                  <div>Created/updated by {selectedProfile.updatedByLabel}</div>
                  <div>Half-day factor: {selectedProfile.halfDayFactor}</div>
                  <div>Note: {selectedProfile.note || "No note"}</div>
                </div>
              </SoTCard>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
