import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  EmployeeDocumentType,
  EmployeeRole,
  ManagerKind,
  Prisma,
  RiderVarianceStatus,
  RunStatus,
  UserAuthState,
  UserRole,
} from "@prisma/client";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import * as React from "react";
import { createHash, randomBytes } from "node:crypto";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import {
  SoTTable,
  SoTTd,
  SoTTh,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
} from "~/components/ui/SoTTable";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { resolveAppBaseUrl, sendPasswordSetupEmail } from "~/utils/mail.server";

type Lane = "RIDER" | "CASHIER" | "STORE_MANAGER";
type SwitchLane = "RIDER" | "CASHIER";

type EmployeeAccountRow = {
  employeeId: number;
  userId: number;
  name: string;
  middleName: string | null;
  alias: string | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  sssNumber: string | null;
  pagIbigNumber: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  lane: Lane;
  managerKind: ManagerKind | null;
  authState: UserAuthState;
  active: boolean;
  complianceFlags: string[];
  createdAt: string;
  addressLine: string | null;
  addressArea: string | null;
};

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

function fullName(firstName: string, lastName: string, middleName?: string | null) {
  return [firstName, middleName ?? null, lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function prettyLane(row: EmployeeAccountRow) {
  if (row.lane === "STORE_MANAGER") {
    return row.managerKind ? `STORE_MANAGER (${row.managerKind})` : "STORE_MANAGER";
  }
  return row.lane;
}

function nextSwitchLane(lane: Lane): SwitchLane | null {
  if (lane === "RIDER") return "CASHIER";
  if (lane === "CASHIER") return "RIDER";
  return null;
}

function toSwitchUserRole(lane: SwitchLane): UserRole {
  return lane === "CASHIER" ? UserRole.CASHIER : UserRole.EMPLOYEE;
}

function toSwitchEmployeeRole(lane: SwitchLane): EmployeeRole {
  return lane === "CASHIER" ? EmployeeRole.STAFF : EmployeeRole.RIDER;
}

function tokenHash(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function requestIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (!fwd) return null;
  return fwd.split(",")[0]?.trim() || null;
}

function formatAddressArea(parts: Array<string | null | undefined>) {
  const clean = parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return clean.length ? clean.join(", ") : null;
}

function presentComplianceFlag(flag: string) {
  return flag.replace(/_/g, " ");
}

function latestDocumentByType<
  T extends {
    docType: EmployeeDocumentType;
    uploadedAt: Date;
    expiresAt: Date | null;
  },
>(docs: T[], docType: EmployeeDocumentType) {
  return docs.find((doc) => doc.docType === docType) ?? null;
}

async function issuePasswordSetupToken(
  tx: Prisma.TransactionClient,
  args: { userId: number; now: Date; requestIp: string | null; userAgent: string | null },
) {
  const rawToken = randomBytes(32).toString("hex");
  await tx.passwordResetToken.updateMany({
    where: {
      userId: args.userId,
      usedAt: null,
      expiresAt: { gt: args.now },
    },
    data: { usedAt: args.now },
  });
  await tx.passwordResetToken.create({
    data: {
      userId: args.userId,
      tokenHash: tokenHash(rawToken),
      expiresAt: new Date(args.now.getTime() + 1000 * 60 * 60 * 24),
      requestedIp: args.requestIp,
      requestedUserAgent: args.userAgent,
    },
  });
  return rawToken;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const employees = await db.employee.findMany({
    where: { user: { isNot: null } },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          managerKind: true,
          authState: true,
          active: true,
          createdAt: true,
        },
      },
      address: {
        select: {
          line1: true,
          barangay: true,
          city: true,
          province: true,
        },
      },
      documents: {
        select: {
          docType: true,
          uploadedAt: true,
          expiresAt: true,
        },
        orderBy: { uploadedAt: "desc" },
      },
    },
    orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
    take: 300,
  });

  const rows: EmployeeAccountRow[] = employees
    .filter((e) => Boolean(e.user))
    .map((e) => {
      const u = e.user!;
      const lane: Lane =
        u.role === UserRole.CASHIER
          ? "CASHIER"
          : u.role === UserRole.STORE_MANAGER
            ? "STORE_MANAGER"
            : "RIDER";

      const latestValidId = latestDocumentByType(e.documents, EmployeeDocumentType.VALID_ID);
      const latestLicenseScan = latestDocumentByType(
        e.documents,
        EmployeeDocumentType.DRIVER_LICENSE_SCAN,
      );
      const now = Date.now();
      const complianceFlags: string[] = [];

      if (!latestValidId) {
        complianceFlags.push("VALID_ID_MISSING");
      } else if (latestValidId.expiresAt && latestValidId.expiresAt.getTime() < now) {
        complianceFlags.push("VALID_ID_EXPIRED");
      }

      if (lane === "RIDER") {
        if (!e.licenseNumber) complianceFlags.push("RIDER_LICENSE_NUMBER_MISSING");
        if (!e.licenseExpiry) {
          complianceFlags.push("RIDER_LICENSE_EXPIRY_MISSING");
        } else if (e.licenseExpiry.getTime() < now) {
          complianceFlags.push("RIDER_LICENSE_EXPIRED");
        }
        if (!latestLicenseScan) {
          complianceFlags.push("RIDER_LICENSE_SCAN_MISSING");
        } else if (latestLicenseScan.expiresAt && latestLicenseScan.expiresAt.getTime() < now) {
          complianceFlags.push("RIDER_LICENSE_SCAN_EXPIRED");
        }
      }

      return {
        employeeId: e.id,
        userId: u.id,
        name: fullName(e.firstName, e.lastName, e.middleName),
        middleName: e.middleName ?? null,
        alias: e.alias ?? null,
        birthDate: e.birthDate ? e.birthDate.toISOString().slice(0, 10) : null,
        phone: e.phone ?? null,
        email: u.email ?? e.email ?? null,
        sssNumber: e.sssNumber ?? null,
        pagIbigNumber: e.pagIbigNumber ?? null,
        licenseNumber: e.licenseNumber ?? null,
        licenseExpiry: e.licenseExpiry ? e.licenseExpiry.toISOString().slice(0, 10) : null,
        lane,
        managerKind: u.managerKind ?? null,
        authState: u.authState,
        active: u.active,
        complianceFlags,
        createdAt: u.createdAt.toISOString(),
        addressLine: e.address?.line1 ?? null,
        addressArea: formatAddressArea([
          e.address?.barangay,
          e.address?.city,
          e.address?.province,
        ]),
      };
    });

  return json({ rows });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "").trim();

  if (intent === "switch-role") {
    const userId = Number(fd.get("userId"));
    const targetLaneRaw = String(fd.get("targetLane") || "").trim();
    const reason = String(fd.get("reason") || "").trim();

    if (!Number.isFinite(userId) || userId <= 0) {
      return json<ActionData>({ ok: false, message: "Invalid user id." }, { status: 400 });
    }
    if (targetLaneRaw !== "RIDER" && targetLaneRaw !== "CASHIER") {
      return json<ActionData>({ ok: false, message: "Invalid target lane." }, { status: 400 });
    }
    if (!reason) {
      return json<ActionData>(
        { ok: false, message: "Reason is required for audit logging." },
        { status: 400 },
      );
    }

    const targetLane = targetLaneRaw as SwitchLane;
    const targetRole = toSwitchUserRole(targetLane);

    const current = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        active: true,
        employeeId: true,
      },
    });
    if (!current) {
      return json<ActionData>({ ok: false, message: "User not found." }, { status: 404 });
    }
    if (!current.active) {
      return json<ActionData>(
        { ok: false, message: "Inactive accounts cannot be switched." },
        { status: 400 },
      );
    }
    if (!current.employeeId) {
      return json<ActionData>(
        { ok: false, message: "Target user has no linked employee profile." },
        { status: 400 },
      );
    }
    if (current.role === UserRole.STORE_MANAGER || targetRole === UserRole.STORE_MANAGER) {
      return json<ActionData>(
        { ok: false, message: "Store manager role is protected and cannot be switched here." },
        { status: 400 },
      );
    }
    if (current.role !== UserRole.CASHIER && current.role !== UserRole.EMPLOYEE) {
      return json<ActionData>(
        { ok: false, message: "Only cashier/rider lanes are switchable." },
        { status: 400 },
      );
    }
    if (current.role === targetRole) {
      return json<ActionData>(
        { ok: false, message: "Target lane is already active." },
        { status: 400 },
      );
    }

    const employee = await db.employee.findUnique({
      where: { id: current.employeeId },
      select: { id: true, active: true },
    });
    if (!employee || !employee.active) {
      return json<ActionData>(
        { ok: false, message: "Linked employee profile must be active before role switch." },
        { status: 400 },
      );
    }
    const currentEmployeeId = current.employeeId;

    if (current.role === UserRole.CASHIER) {
      const openShift = await db.cashierShift.findFirst({
        where: { cashierId: current.id, closedAt: null },
        select: { id: true },
      });
      if (openShift) {
        return json<ActionData>(
          { ok: false, message: "Close the cashier shift first before switching to rider." },
          { status: 400 },
        );
      }
    }

    if (current.role === UserRole.EMPLOYEE) {
      const activeRun = await db.deliveryRun.findFirst({
        where: {
          riderId: current.employeeId,
          status: {
            in: [RunStatus.PLANNED, RunStatus.DISPATCHED, RunStatus.CHECKED_IN],
          },
        },
        select: { id: true, status: true },
      });
      if (activeRun) {
        return json<ActionData>(
          { ok: false, message: "Rider has active run obligations. Reassign runs first." },
          { status: 400 },
        );
      }

      const pendingVariance = await db.riderRunVariance.findFirst({
        where: {
          riderId: current.employeeId,
          status: {
            in: [RiderVarianceStatus.OPEN, RiderVarianceStatus.MANAGER_APPROVED],
          },
        },
        select: { id: true },
      });
      if (pendingVariance) {
        return json<ActionData>(
          { ok: false, message: "Rider has pending variance tasks. Resolve them first." },
          { status: 400 },
        );
      }
    }

    try {
      const now = new Date();
      await db.$transaction(async (tx) => {
        await tx.userRoleAssignment.updateMany({
          where: { userId: current.id, endedAt: null },
          data: { endedAt: now },
        });

        await tx.user.update({
          where: { id: current.id },
          data: {
            role: targetRole,
            managerKind: null,
            authVersion: { increment: 1 },
          },
        });

        await tx.employee.update({
          where: { id: currentEmployeeId },
          data: { role: toSwitchEmployeeRole(targetLane) },
        });

        await tx.userRoleAssignment.create({
          data: {
            userId: current.id,
            role: targetRole,
            startedAt: now,
            reason,
            changedById: me.userId,
          },
        });

        await tx.userRoleAuditEvent.create({
          data: {
            userId: current.id,
            beforeRole: current.role,
            afterRole: targetRole,
            reason,
            changedById: me.userId,
          },
        });
      });

      return json<ActionData>({
        ok: true,
        message: `Role switched to ${targetLane}. User must re-login with new role lane.`,
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return json<ActionData>(
          { ok: false, message: "Duplicate value detected during role switch." },
          { status: 400 },
        );
      }
      const message = e instanceof Error ? e.message : "Role switch failed.";
      return json<ActionData>({ ok: false, message }, { status: 500 });
    }
  }

  if (intent === "resend-invite") {
    const userId = Number(fd.get("userId"));
    if (!Number.isFinite(userId) || userId <= 0) {
      return json<ActionData>({ ok: false, message: "Invalid user id." }, { status: 400 });
    }

    const target = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        active: true,
        authState: true,
      },
    });
    if (!target || !target.email) {
      return json<ActionData>({ ok: false, message: "User not found." }, { status: 404 });
    }
    if (!target.active) {
      return json<ActionData>(
        { ok: false, message: "Inactive accounts cannot receive setup invites." },
        { status: 400 },
      );
    }
    if (target.authState !== UserAuthState.PENDING_PASSWORD) {
      return json<ActionData>(
        { ok: false, message: "Password setup is already completed for this account." },
        { status: 400 },
      );
    }

    const now = new Date();
    const ip = requestIp(request);
    const ua = request.headers.get("user-agent");
    let inviteToken = "";

    await db.$transaction(async (tx) => {
      inviteToken = await issuePasswordSetupToken(tx, {
        userId: target.id,
        now,
        requestIp: ip,
        userAgent: ua,
      });
    });

    try {
      const setupUrl = `${resolveAppBaseUrl(request)}/reset-password/${inviteToken}`;
      await sendPasswordSetupEmail({ to: target.email, setupUrl });
      return json<ActionData>({
        ok: true,
        message: "Password setup link re-sent.",
      });
    } catch (mailError) {
      console.error("[auth] resend invite failed", mailError);
      return json<ActionData>(
        {
          ok: false,
          message:
            "Invite token was refreshed but email send failed. User can use Forgot password.",
        },
        { status: 500 },
      );
    }
  }

  if (intent === "toggle-active") {
    const userId = Number(fd.get("userId"));
    if (!Number.isFinite(userId) || userId <= 0) {
      return json<ActionData>({ ok: false, message: "Invalid user id." }, { status: 400 });
    }

    const current = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, active: true, employeeId: true },
    });
    if (!current) {
      return json<ActionData>({ ok: false, message: "User not found." }, { status: 404 });
    }
    if (current.role === UserRole.ADMIN) {
      return json<ActionData>(
        { ok: false, message: "Admin accounts cannot be toggled here." },
        { status: 400 },
      );
    }

    await db.$transaction(async (tx) => {
      const next = !current.active;
      await tx.user.update({ where: { id: current.id }, data: { active: next } });
      if (current.employeeId) {
        await tx.employee.update({
          where: { id: current.employeeId },
          data: { active: next },
        });
      }
    });

    return json<ActionData>({
      ok: true,
      message: current.active ? "Account deactivated." : "Account reactivated.",
    });
  }

  return json<ActionData>({ ok: false, message: "Unknown intent." }, { status: 400 });
}

export default function EmployeeDirectoryPage() {
  const { rows } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Creation - Employees"
        subtitle="Directory and account controls. Use the create page for new employee onboarding."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-7xl"
      />

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {actionData ? (
          <SoTAlert tone={actionData.ok ? "success" : "danger"}>{actionData.message}</SoTAlert>
        ) : null}

        <SoTCard className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Manage role switches, invites, and account state. Compliance badges are monitoring-only and never block create/switch actions.
          </p>
          <Link
            to="/creation/employees/new"
            className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Create New Employee
          </Link>
        </SoTCard>

        <SoTCard>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Employee Accounts
          </div>
          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Name</SoTTh>
                <SoTTh>Lane</SoTTh>
                <SoTTh>Login</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh>Compliance</SoTTh>
                <SoTTh>Role Switch</SoTTh>
                <SoTTh align="right">Account</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow colSpan={7} message="No employee accounts yet." />
              ) : (
                rows.map((row: EmployeeAccountRow) => (
                  <SoTTableRow key={row.userId}>
                    <SoTTd>
                      <div className="font-medium text-slate-900">{row.name}</div>
                      <div className="text-xs text-slate-500">
                        {row.alias ? `${row.alias} · ` : ""}
                        {row.phone ?? "No phone"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {row.addressLine ? (
                          <>
                            {row.addressLine}
                            {row.addressArea ? ` · ${row.addressArea}` : ""}
                          </>
                        ) : (
                          "No address on file"
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {row.birthDate ? `Birth: ${row.birthDate}` : "Birth: -"} · SSS: {row.sssNumber ?? "-"}
                        {" "}· Pag-IBIG: {row.pagIbigNumber ?? "-"}
                      </div>
                    </SoTTd>
                    <SoTTd>{prettyLane(row)}</SoTTd>
                    <SoTTd>
                      Email/Password
                      <div className="text-xs text-slate-500">{row.email ?? "No email"}</div>
                    </SoTTd>
                    <SoTTd>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {row.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <div className="mt-1">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            row.authState === "ACTIVE"
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {row.authState === "ACTIVE" ? "PASSWORD_READY" : "PENDING_PASSWORD"}
                        </span>
                      </div>
                    </SoTTd>
                    <SoTTd>
                      {row.complianceFlags.length === 0 ? (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          COMPLIANT
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.complianceFlags.slice(0, 4).map((flag) => (
                            <span
                              key={`${row.userId}-${flag}`}
                              className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                              title={presentComplianceFlag(flag)}
                            >
                              {presentComplianceFlag(flag)}
                            </span>
                          ))}
                          {row.complianceFlags.length > 4 ? (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              +{row.complianceFlags.length - 4} more
                            </span>
                          ) : null}
                        </div>
                      )}
                    </SoTTd>
                    <SoTTd>
                      {nextSwitchLane(row.lane) ? (
                        <Form method="post" className="space-y-2">
                          <input type="hidden" name="intent" value="switch-role" />
                          <input type="hidden" name="userId" value={row.userId} />
                          <input
                            type="hidden"
                            name="targetLane"
                            value={nextSwitchLane(row.lane) ?? ""}
                          />

                          <input
                            name="reason"
                            required
                            placeholder="Switch reason"
                            className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                          />

                          <SoTButton type="submit" variant="secondary" disabled={busy}>
                            {row.lane === "CASHIER" ? "Switch to RIDER" : "Switch to CASHIER"}
                          </SoTButton>
                        </Form>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Protected lane. Manager switch is blocked here.
                        </p>
                      )}
                    </SoTTd>
                    <SoTTd align="right">
                      <div className="space-y-2">
                        <Link
                          to={`/creation/employees/${row.employeeId}/edit`}
                          className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Edit Profile
                        </Link>

                        {row.authState === "PENDING_PASSWORD" && row.active ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="resend-invite" />
                            <input type="hidden" name="userId" value={row.userId} />
                            <SoTButton type="submit" variant="secondary" disabled={busy}>
                              Resend Invite
                            </SoTButton>
                          </Form>
                        ) : null}

                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle-active" />
                          <input type="hidden" name="userId" value={row.userId} />
                          <SoTButton type="submit" variant="secondary" disabled={busy}>
                            {row.active ? "Deactivate" : "Activate"}
                          </SoTButton>
                        </Form>
                      </div>
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
