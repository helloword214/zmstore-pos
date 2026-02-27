import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  EmployeeRole,
  ManagerKind,
  Prisma,
  RiderVarianceStatus,
  RunStatus,
  UserAuthState,
  UserRole,
} from "@prisma/client";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import * as React from "react";
import { createHash, randomBytes } from "node:crypto";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
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
  alias: string | null;
  phone: string | null;
  email: string | null;
  lane: Lane;
  managerKind: ManagerKind | null;
  authState: UserAuthState;
  active: boolean;
  createdAt: string;
  addressLine: string | null;
  addressArea: string | null;
};

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

function isLane(value: string): value is Lane {
  return value === "RIDER" || value === "CASHIER" || value === "STORE_MANAGER";
}

function isSwitchLane(value: string): value is SwitchLane {
  return value === "RIDER" || value === "CASHIER";
}

function toEmployeeRole(lane: Lane): EmployeeRole {
  if (lane === "RIDER") return EmployeeRole.RIDER;
  if (lane === "STORE_MANAGER") return EmployeeRole.MANAGER;
  return EmployeeRole.STAFF;
}

function toUserRole(lane: Lane): UserRole {
  if (lane === "RIDER") return UserRole.EMPLOYEE;
  if (lane === "STORE_MANAGER") return UserRole.STORE_MANAGER;
  return UserRole.CASHIER;
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

function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

function tokenHash(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function requestIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (!fwd) return null;
  return fwd.split(",")[0]?.trim() || null;
}

function parseOptionalId(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function formatAddressArea(parts: Array<string | null | undefined>) {
  const clean = parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return clean.length ? clean.join(", ") : null;
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

  const [
    employees,
    vehicles,
    defaultBranch,
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
  ] = await Promise.all([
    db.employee.findMany({
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
      },
      orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      take: 300,
    }),
    db.vehicle.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    db.branch.findFirst({
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    }),
    db.province.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    db.municipality.findMany({
      where: { isActive: true },
      orderBy: [{ provinceId: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, provinceId: true },
    }),
    db.barangay.findMany({
      where: { isActive: true },
      orderBy: [{ municipalityId: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, municipalityId: true },
    }),
    db.zone.findMany({
      where: { isActive: true },
      orderBy: [{ barangayId: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, barangayId: true },
    }),
    db.landmark.findMany({
      where: { isActive: true },
      orderBy: [{ barangayId: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, barangayId: true },
    }),
  ]);

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

      return {
        employeeId: e.id,
        userId: u.id,
        name: fullName(e.firstName, e.lastName),
        alias: e.alias ?? null,
        phone: e.phone ?? null,
        email: u.email ?? e.email ?? null,
        lane,
        managerKind: u.managerKind ?? null,
        authState: u.authState,
        active: u.active,
        createdAt: u.createdAt.toISOString(),
        addressLine: e.address?.line1 ?? null,
        addressArea: formatAddressArea([
          e.address?.barangay,
          e.address?.city,
          e.address?.province,
        ]),
      };
    });

  return json({
    rows,
    vehicles,
    defaultBranch,
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "").trim();

  if (intent === "create") {
    const laneRaw = String(fd.get("lane") || "").trim();
    if (!isLane(laneRaw)) {
      return json<ActionData>(
        { ok: false, message: "Invalid lane selected." },
        { status: 400 },
      );
    }
    const lane = laneRaw as Lane;

    const firstName = String(fd.get("firstName") || "").trim();
    const lastName = String(fd.get("lastName") || "").trim();
    const alias = String(fd.get("alias") || "").trim() || null;
    const phone = String(fd.get("phone") || "").trim() || null;
    const email = String(fd.get("email") || "")
      .trim()
      .toLowerCase();
    const defaultVehicleRaw = String(fd.get("defaultVehicleId") || "").trim();
    const defaultVehicleId = defaultVehicleRaw ? Number(defaultVehicleRaw) : null;

    const line1 = String(fd.get("line1") || "").trim();
    const purok = String(fd.get("purok") || "").trim() || null;
    const postalCode = String(fd.get("postalCode") || "").trim() || null;
    const landmarkText = String(fd.get("landmarkText") || "").trim() || null;

    const provinceId = parseOptionalId(fd.get("provinceId"));
    const municipalityId = parseOptionalId(fd.get("municipalityId"));
    const barangayId = parseOptionalId(fd.get("barangayId"));
    const zoneId = parseOptionalId(fd.get("zoneId"));
    const landmarkId = parseOptionalId(fd.get("landmarkId"));

    if (!firstName || !lastName || !phone) {
      return json<ActionData>(
        { ok: false, message: "First name, last name, and phone are required." },
        { status: 400 },
      );
    }
    if (!email) {
      return json<ActionData>(
        { ok: false, message: "Email is required (no email, no account)." },
        { status: 400 },
      );
    }
    if (!line1) {
      return json<ActionData>(
        { ok: false, message: "House/Street address is required." },
        { status: 400 },
      );
    }
    if (!provinceId || !municipalityId || !barangayId) {
      return json<ActionData>(
        {
          ok: false,
          message:
            "Province, municipality/city, and barangay are required for employee address.",
        },
        { status: 400 },
      );
    }

    const [provinceRow, municipalityRow, barangayRow] = await Promise.all([
      db.province.findFirst({
        where: { id: provinceId, isActive: true },
        select: { id: true, name: true },
      }),
      db.municipality.findFirst({
        where: {
          id: municipalityId,
          provinceId,
          isActive: true,
        },
        select: { id: true, name: true },
      }),
      db.barangay.findFirst({
        where: {
          id: barangayId,
          municipalityId,
          isActive: true,
        },
        select: { id: true, name: true },
      }),
    ]);

    if (!provinceRow || !municipalityRow || !barangayRow) {
      return json<ActionData>(
        {
          ok: false,
          message:
            "Invalid address hierarchy. Re-select province, municipality, and barangay.",
        },
        { status: 400 },
      );
    }

    let zoneRow: { id: number; name: string } | null = null;
    if (zoneId) {
      zoneRow = await db.zone.findFirst({
        where: {
          id: zoneId,
          barangayId,
          isActive: true,
        },
        select: { id: true, name: true },
      });
      if (!zoneRow) {
        return json<ActionData>(
          { ok: false, message: "Selected zone/purok is invalid for the chosen barangay." },
          { status: 400 },
        );
      }
    }

    let landmarkRow: { id: number; name: string } | null = null;
    if (landmarkId) {
      landmarkRow = await db.landmark.findFirst({
        where: {
          id: landmarkId,
          isActive: true,
          OR: [{ barangayId: null }, { barangayId }],
        },
        select: { id: true, name: true },
      });
      if (!landmarkRow) {
        return json<ActionData>(
          { ok: false, message: "Selected landmark is invalid for the chosen barangay." },
          { status: 400 },
        );
      }
    }

    try {
      const now = new Date();
      const ip = requestIp(request);
      const ua = request.headers.get("user-agent");
      let inviteToken = "";
      let inviteEmail = email;

      await db.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            firstName,
            lastName,
            alias,
            phone,
            email,
            role: toEmployeeRole(lane),
            active: true,
            defaultVehicleId: lane === "RIDER" ? defaultVehicleId || null : null,
          },
          select: { id: true },
        });

        await tx.employeeAddress.create({
          data: {
            employeeId: employee.id,
            line1,
            provinceId,
            municipalityId,
            barangayId,
            zoneId: zoneRow?.id ?? null,
            landmarkId: landmarkRow?.id ?? null,
            province: provinceRow.name,
            city: municipalityRow.name,
            barangay: barangayRow.name,
            purok,
            postalCode,
            landmark: landmarkText || landmarkRow?.name || null,
            geoLat: null,
            geoLng: null,
          },
        });

        const defaultBranch = await tx.branch.findFirst({
          orderBy: { id: "asc" },
          select: { id: true },
        });

        const user = await tx.user.create({
          data: {
            email,
            role: toUserRole(lane),
            managerKind: lane === "STORE_MANAGER" ? ManagerKind.STAFF : null,
            employeeId: employee.id,
            active: true,
            authState: UserAuthState.PENDING_PASSWORD,
            passwordHash: null,
            pinHash: null,
            branches: defaultBranch
              ? { create: { branchId: defaultBranch.id } }
              : undefined,
          },
          select: { id: true, role: true, email: true },
        });

        await tx.userRoleAssignment.create({
          data: {
            userId: user.id,
            role: user.role,
            reason: "INITIAL_CREATE_BY_ADMIN",
            changedById: me.userId,
          },
        });

        await tx.userRoleAuditEvent.create({
          data: {
            userId: user.id,
            beforeRole: user.role,
            afterRole: user.role,
            reason: "INITIAL_CREATE_BY_ADMIN",
            changedById: me.userId,
          },
        });

        inviteEmail = user.email ?? email;
        inviteToken = await issuePasswordSetupToken(tx, {
          userId: user.id,
          now,
          requestIp: ip,
          userAgent: ua,
        });
      });

      const setupUrl = `${resolveAppBaseUrl(request)}/reset-password/${inviteToken}`;
      try {
        await sendPasswordSetupEmail({ to: inviteEmail, setupUrl });
        return json<ActionData>({
          ok: true,
          message: "Employee account created with primary address. Setup link sent via email.",
        });
      } catch (mailError) {
        console.error("[auth] employee invite send failed", mailError);
        return json<ActionData>({
          ok: true,
          message:
            "Employee account created with primary address, but setup email failed. User can use Forgot password.",
        });
      }
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return json<ActionData>(
          { ok: false, message: "Duplicate value detected (email or phone already exists)." },
          { status: 400 },
        );
      }
      const message = e instanceof Error ? e.message : "Employee creation failed.";
      return json<ActionData>({ ok: false, message }, { status: 500 });
    }
  }

  if (intent === "switch-role") {
    const userId = Number(fd.get("userId"));
    const targetLaneRaw = String(fd.get("targetLane") || "").trim();
    const reason = String(fd.get("reason") || "").trim();

    if (!Number.isFinite(userId) || userId <= 0) {
      return json<ActionData>(
        { ok: false, message: "Invalid user id." },
        { status: 400 },
      );
    }
    if (!isSwitchLane(targetLaneRaw)) {
      return json<ActionData>(
        { ok: false, message: "Invalid target lane." },
        { status: 400 },
      );
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
          where: { id: current.employeeId },
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
      return json<ActionData>(
        { ok: false, message: "Invalid user id." },
        { status: 400 },
      );
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
      return json<ActionData>(
        { ok: false, message: "Invalid user id." },
        { status: 400 },
      );
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

export default function EmployeeCreationPage() {
  const {
    rows,
    vehicles,
    defaultBranch,
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [lane, setLane] = React.useState<Lane>("RIDER");

  const initialProvince = provinces[0]?.id ?? "";
  const initialMunicipality =
    municipalities.find((m) => m.provinceId === initialProvince)?.id ?? "";
  const initialBarangay =
    barangays.find((b) => b.municipalityId === initialMunicipality)?.id ?? "";

  const [provinceId, setProvinceId] = React.useState<number | "">(initialProvince);
  const [municipalityId, setMunicipalityId] = React.useState<number | "">(initialMunicipality);
  const [barangayId, setBarangayId] = React.useState<number | "">(initialBarangay);
  const [zoneId, setZoneId] = React.useState<number | "">("");
  const [landmarkId, setLandmarkId] = React.useState<number | "">("");

  const municipalityOptions = React.useMemo(
    () =>
      municipalities.filter((m) => m.provinceId === (provinceId === "" ? -1 : provinceId)),
    [municipalities, provinceId],
  );

  const barangayOptions = React.useMemo(
    () =>
      barangays.filter(
        (b) => b.municipalityId === (municipalityId === "" ? -1 : municipalityId),
      ),
    [barangays, municipalityId],
  );

  const zoneOptions = React.useMemo(
    () => zones.filter((z) => z.barangayId === (barangayId === "" ? -1 : barangayId)),
    [zones, barangayId],
  );

  const landmarkOptions = React.useMemo(
    () =>
      landmarks.filter(
        (l) => l.barangayId === null || l.barangayId === (barangayId === "" ? -1 : barangayId),
      ),
    [landmarks, barangayId],
  );

  function onProvinceChange(raw: string) {
    const nextProvince = Number(raw) || "";
    const nextMunicipality =
      nextProvince === ""
        ? ""
        : municipalities.find((m) => m.provinceId === nextProvince)?.id ?? "";
    const nextBarangay =
      nextMunicipality === ""
        ? ""
        : barangays.find((b) => b.municipalityId === nextMunicipality)?.id ?? "";

    setProvinceId(nextProvince);
    setMunicipalityId(nextMunicipality);
    setBarangayId(nextBarangay);
    setZoneId("");
    setLandmarkId("");
  }

  function onMunicipalityChange(raw: string) {
    const nextMunicipality = Number(raw) || "";
    const nextBarangay =
      nextMunicipality === ""
        ? ""
        : barangays.find((b) => b.municipalityId === nextMunicipality)?.id ?? "";

    setMunicipalityId(nextMunicipality);
    setBarangayId(nextBarangay);
    setZoneId("");
    setLandmarkId("");
  }

  function onBarangayChange(raw: string) {
    const nextBarangay = Number(raw) || "";
    setBarangayId(nextBarangay);
    setZoneId("");
    setLandmarkId("");
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Creation - Employees"
        subtitle="Create employee identity, capture primary address, and send password setup invite."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-7xl"
      />

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {actionData ? (
          <SoTAlert tone={actionData.ok ? "success" : "danger"}>{actionData.message}</SoTAlert>
        ) : null}

        <SoTCard>
          <Form method="post" className={busy ? "pointer-events-none opacity-70" : ""}>
            <input type="hidden" name="intent" value="create" />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Identity and Role</h3>
                  <p className="text-xs text-slate-500">
                    Email is mandatory. No email means no account creation.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SoTFormField
                    label="Lane"
                    hint="Supported lanes: CASHIER, RIDER, STORE_MANAGER."
                  >
                    <select
                      name="lane"
                      value={lane}
                      onChange={(e) => setLane(e.target.value as Lane)}
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                    >
                      <option value="RIDER">RIDER</option>
                      <option value="CASHIER">CASHIER</option>
                      <option value="STORE_MANAGER">STORE_MANAGER (staff)</option>
                    </select>
                  </SoTFormField>

                  <SoTInput name="firstName" label="First Name" required />
                  <SoTInput name="lastName" label="Last Name" required />
                  <SoTInput name="alias" label="Alias (optional)" />
                  <SoTInput
                    name="phone"
                    label="Phone"
                    inputMode="numeric"
                    required
                    placeholder="09XXXXXXXXX"
                  />
                  <SoTInput name="email" label="Email" type="email" required />

                  <SoTFormField
                    label="Default Vehicle (Rider only)"
                    hint="Ignored for cashier and store manager."
                  >
                    <select
                      name="defaultVehicleId"
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                    >
                      <option value="">None</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.type})
                        </option>
                      ))}
                    </select>
                  </SoTFormField>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Primary Address</h3>
                  <p className="text-xs text-slate-500">
                    Uses canonical address masters (province → municipality → barangay).
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SoTInput name="line1" label="House/Street" required />
                  <SoTInput name="purok" label="Purok (text, optional)" />
                  <SoTInput name="postalCode" label="Postal Code (optional)" />
                  <SoTInput name="landmarkText" label="Landmark (text, optional)" />

                  <SoTFormField label="Province">
                    <select
                      name="provinceId"
                      value={provinceId}
                      onChange={(e) => onProvinceChange(e.target.value)}
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                      required
                    >
                      <option value="">Select province</option>
                      {provinces.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </SoTFormField>

                  <SoTFormField label="Municipality / City">
                    <select
                      name="municipalityId"
                      value={municipalityId}
                      onChange={(e) => onMunicipalityChange(e.target.value)}
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                      required
                    >
                      <option value="">Select municipality</option>
                      {municipalityOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </SoTFormField>

                  <SoTFormField label="Barangay">
                    <select
                      name="barangayId"
                      value={barangayId}
                      onChange={(e) => onBarangayChange(e.target.value)}
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                      required
                    >
                      <option value="">Select barangay</option>
                      {barangayOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </SoTFormField>

                  <SoTFormField label="Zone / Purok (ref, optional)">
                    <select
                      name="zoneId"
                      value={zoneId}
                      onChange={(e) => setZoneId(Number(e.target.value) || "")}
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                      disabled={barangayId === ""}
                    >
                      <option value="">None</option>
                      {zoneOptions.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </SoTFormField>

                  <SoTFormField label="Landmark (ref, optional)">
                    <select
                      name="landmarkId"
                      value={landmarkId}
                      onChange={(e) => setLandmarkId(Number(e.target.value) || "")}
                      className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                      disabled={barangayId === ""}
                    >
                      <option value="">None</option>
                      {landmarkOptions.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </SoTFormField>
                </div>
              </section>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Default branch assignment: {defaultBranch ? defaultBranch.name : "None configured"}. Password setup link will be sent to employee email.
              </p>
              <SoTButton variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving..." : "Create Employee Account"}
              </SoTButton>
            </div>
          </Form>
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
                <SoTTh>Role Switch</SoTTh>
                <SoTTh align="right">Account</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow colSpan={6} message="No employee accounts yet." />
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
                    </SoTTd>
                    <SoTTd>{prettyLane(row)}</SoTTd>
                    <SoTTd>
                      Email/Password
                      <div className="text-xs text-slate-500">{row.email ?? "No email"}</div>
                    </SoTTd>
                    <SoTTd>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-700"
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
