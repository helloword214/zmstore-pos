import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  EmployeeDocumentType,
  EmployeeRole,
  ManagerKind,
  Prisma,
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
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { resolveAppBaseUrl, sendPasswordSetupEmail } from "~/utils/mail.server";
import { storage } from "~/utils/storage.server";

type Lane = "RIDER" | "CASHIER" | "STORE_MANAGER";

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

type EmployeeDocUpload = {
  label: string;
  docType: EmployeeDocumentType;
  file: File;
  expiresAt: Date | null;
};

const MAX_DOC_UPLOAD_MB = Math.max(
  1,
  Number.parseFloat(process.env.MAX_DOC_UPLOAD_MB || process.env.MAX_UPLOAD_MB || "10") || 10,
);
const MAX_DOC_UPLOAD_BYTES = Math.floor(MAX_DOC_UPLOAD_MB * 1024 * 1024);
const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isLane(value: string): value is Lane {
  return value === "RIDER" || value === "CASHIER" || value === "STORE_MANAGER";
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

function parseOptionalDate(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function readOptionalUpload(raw: FormDataEntryValue | null): File | null {
  if (!(raw instanceof File)) return null;
  if (!raw.size) return null;
  return raw;
}

function validateDocUpload(file: File) {
  if (!ALLOWED_DOC_MIME.has(file.type)) {
    return "Only PDF, JPG, PNG, and WEBP files are allowed.";
  }
  if (file.size > MAX_DOC_UPLOAD_BYTES) {
    return `File is too large. Limit is ${MAX_DOC_UPLOAD_MB}MB.`;
  }
  return null;
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
    vehicles,
    defaultBranch,
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
  ] = await Promise.all([
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

  return json({
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

  if (intent !== "create") {
    return json<ActionData>({ ok: false, message: "Unknown intent." }, { status: 400 });
  }

  const laneRaw = String(fd.get("lane") || "").trim();
  if (!isLane(laneRaw)) {
    return json<ActionData>({ ok: false, message: "Invalid lane selected." }, { status: 400 });
  }
  const lane = laneRaw as Lane;

  const firstName = String(fd.get("firstName") || "").trim();
  const middleName = String(fd.get("middleName") || "").trim() || null;
  const lastName = String(fd.get("lastName") || "").trim();
  const alias = String(fd.get("alias") || "").trim() || null;
  const birthDate = parseOptionalDate(fd.get("birthDate"));
  const phone = String(fd.get("phone") || "").trim() || null;
  const email = String(fd.get("email") || "")
    .trim()
    .toLowerCase();
  const sssNumber = String(fd.get("sssNumber") || "").trim() || null;
  const pagIbigNumber = String(fd.get("pagIbigNumber") || "").trim() || null;
  const licenseNumber = String(fd.get("licenseNumber") || "").trim() || null;
  const licenseExpiry = parseOptionalDate(fd.get("licenseExpiry"));
  const validIdExpiry = parseOptionalDate(fd.get("validIdExpiry"));
  const driverLicenseScanExpiry =
    parseOptionalDate(fd.get("driverLicenseScanExpiry")) ?? licenseExpiry;

  const barangayClearanceFile = readOptionalUpload(fd.get("barangayClearanceFile"));
  const validIdFile = readOptionalUpload(fd.get("validIdFile"));
  const driverLicenseFile = readOptionalUpload(fd.get("driverLicenseFile"));
  const policeClearanceFile = readOptionalUpload(fd.get("policeClearanceFile"));
  const nbiClearanceFile = readOptionalUpload(fd.get("nbiClearanceFile"));
  const photo2x2File = readOptionalUpload(fd.get("photo2x2File"));
  const resumeFile = readOptionalUpload(fd.get("resumeFile"));

  const docsToUpload: EmployeeDocUpload[] = [];
  if (barangayClearanceFile) {
    docsToUpload.push({
      label: "Barangay clearance",
      docType: EmployeeDocumentType.BARANGAY_CLEARANCE,
      file: barangayClearanceFile,
      expiresAt: null,
    });
  }
  if (validIdFile) {
    docsToUpload.push({
      label: "Valid ID",
      docType: EmployeeDocumentType.VALID_ID,
      file: validIdFile,
      expiresAt: validIdExpiry,
    });
  }
  if (driverLicenseFile) {
    docsToUpload.push({
      label: "Driver license scan",
      docType: EmployeeDocumentType.DRIVER_LICENSE_SCAN,
      file: driverLicenseFile,
      expiresAt: driverLicenseScanExpiry,
    });
  }
  if (policeClearanceFile) {
    docsToUpload.push({
      label: "Police clearance",
      docType: EmployeeDocumentType.POLICE_CLEARANCE,
      file: policeClearanceFile,
      expiresAt: null,
    });
  }
  if (nbiClearanceFile) {
    docsToUpload.push({
      label: "NBI clearance",
      docType: EmployeeDocumentType.NBI_CLEARANCE,
      file: nbiClearanceFile,
      expiresAt: null,
    });
  }
  if (photo2x2File) {
    docsToUpload.push({
      label: "2x2 photo",
      docType: EmployeeDocumentType.PHOTO_2X2,
      file: photo2x2File,
      expiresAt: null,
    });
  }
  if (resumeFile) {
    docsToUpload.push({
      label: "Resume",
      docType: EmployeeDocumentType.RESUME,
      file: resumeFile,
      expiresAt: null,
    });
  }

  for (const doc of docsToUpload) {
    const docError = validateDocUpload(doc.file);
    if (docError) {
      return json<ActionData>(
        { ok: false, message: `${doc.label}: ${docError}` },
        { status: 400 },
      );
    }
  }

  const defaultVehicleRaw = String(fd.get("defaultVehicleId") || "").trim();
  const parsedDefaultVehicleId = defaultVehicleRaw ? Number(defaultVehicleRaw) : Number.NaN;
  if (
    defaultVehicleRaw &&
    (!Number.isFinite(parsedDefaultVehicleId) || parsedDefaultVehicleId <= 0)
  ) {
    return json<ActionData>(
      { ok: false, message: "Invalid default vehicle value." },
      { status: 400 },
    );
  }
  const defaultVehicleId = defaultVehicleRaw ? parsedDefaultVehicleId : null;

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
        message: "Invalid address hierarchy. Re-select province, municipality, and barangay.",
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
    let createdEmployeeId: number | null = null;

    await db.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          firstName,
          middleName,
          lastName,
          alias,
          birthDate,
          phone,
          email,
          sssNumber,
          pagIbigNumber,
          licenseNumber,
          licenseExpiry,
          role: toEmployeeRole(lane),
          active: true,
          defaultVehicleId: lane === "RIDER" ? defaultVehicleId || null : null,
        },
        select: { id: true },
      });
      createdEmployeeId = employee.id;

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

    if (!createdEmployeeId) {
      return json<ActionData>(
        { ok: false, message: "Employee profile was not created." },
        { status: 500 },
      );
    }

    let uploadedDocCount = 0;
    const docUploadFailures: string[] = [];
    for (const doc of docsToUpload) {
      try {
        const saved = await storage.save(doc.file, {
          keyPrefix: `employees/${createdEmployeeId}/${doc.docType.toLowerCase()}`,
        });
        await db.employeeDocument.create({
          data: {
            employeeId: createdEmployeeId,
            docType: doc.docType,
            fileKey: saved.key,
            fileUrl: saved.url,
            mimeType: saved.contentType,
            sizeBytes: saved.size,
            expiresAt: doc.expiresAt,
            uploadedById: me.userId,
          },
        });
        uploadedDocCount += 1;
      } catch (docErr) {
        console.error("[employee-doc] upload failed", docErr);
        docUploadFailures.push(doc.label);
      }
    }

    const setupUrl = `${resolveAppBaseUrl(request)}/reset-password/${inviteToken}`;
    const documentSummary =
      uploadedDocCount > 0
        ? ` ${uploadedDocCount} compliance document(s) uploaded.`
        : " No compliance documents uploaded yet.";
    const failureSummary = docUploadFailures.length
      ? ` Document upload failed for: ${docUploadFailures.join(", ")}.`
      : "";

    try {
      await sendPasswordSetupEmail({ to: inviteEmail, setupUrl });
      return json<ActionData>({
        ok: true,
        message: `Employee account created with primary address.${documentSummary}${failureSummary} Setup link sent via email.`,
      });
    } catch (mailError) {
      console.error("[auth] employee invite send failed", mailError);
      return json<ActionData>({
        ok: true,
        message: `Employee account created with primary address.${documentSummary}${failureSummary} Setup email failed. User can use Forgot password.`,
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

export default function EmployeeCreatePage() {
  const {
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
    () => municipalities.filter((m) => m.provinceId === (provinceId === "" ? -1 : provinceId)),
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
        title="Creation - Employees (New)"
        subtitle="Create employee identity, capture address and compliance data, then send setup invite."
        backTo="/creation/employees"
        backLabel="Employee Directory"
        maxWidthClassName="max-w-7xl"
      />

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {actionData ? (
          <SoTAlert tone={actionData.ok ? "success" : "danger"}>{actionData.message}</SoTAlert>
        ) : null}

        <SoTCard>
          <Form
            method="post"
            encType="multipart/form-data"
            className={busy ? "pointer-events-none opacity-70" : ""}
          >
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
                  <SoTInput name="middleName" label="Middle Name (optional)" />
                  <SoTInput name="lastName" label="Last Name" required />
                  <SoTInput name="alias" label="Alias (optional)" />
                  <SoTInput name="birthDate" label="Birth Date (optional)" type="date" />
                  <SoTInput
                    name="phone"
                    label="Phone"
                    inputMode="numeric"
                    required
                    placeholder="09XXXXXXXXX"
                  />
                  <SoTInput name="email" label="Email" type="email" required />
                  <SoTInput name="sssNumber" label="SSS Number (optional)" />
                  <SoTInput name="pagIbigNumber" label="Pag-IBIG Number (optional)" />
                  <SoTInput name="licenseNumber" label="License Number (optional)" />
                  <SoTInput name="licenseExpiry" label="License Expiry (optional)" type="date" />

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
                    Uses canonical address masters (province to municipality to barangay).
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

            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Compliance Documents</h3>
                <p className="text-xs text-slate-500">
                  Upload scanned files (PDF/JPG/PNG/WEBP). Full upload history is preserved per document type.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Monitoring-only: missing files never block employee creation or role switching.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                <SoTInput name="validIdExpiry" label="Valid ID Expiry (optional)" type="date" />
                <SoTInput
                  name="driverLicenseScanExpiry"
                  label="Driver License Scan Expiry (optional)"
                  type="date"
                />

                <SoTFormField
                  label="Barangay Clearance Scan (optional)"
                  hint="Hiring/reference file (no expiry tracking)."
                >
                  <input
                    type="file"
                    name="barangayClearanceFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField
                  label="Valid ID Scan (optional)"
                  hint="Monitoring-only in this phase."
                >
                  <input
                    type="file"
                    name="validIdFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField
                  label="Driver License Scan (optional)"
                  hint="Recommended for rider profiles."
                >
                  <input
                    type="file"
                    name="driverLicenseFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField
                  label="Police Clearance Scan (optional)"
                  hint="Hiring/reference file (no expiry tracking)."
                >
                  <input
                    type="file"
                    name="policeClearanceFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField
                  label="NBI Clearance Scan (optional)"
                  hint="Hiring/reference file (no expiry tracking)."
                >
                  <input
                    type="file"
                    name="nbiClearanceFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="2x2 Photo (optional)" hint="Stored in employee document history.">
                  <input
                    type="file"
                    name="photo2x2File"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="Resume (optional)" hint="Recommended as PDF.">
                  <input
                    type="file"
                    name="resumeFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>
              </div>
            </section>

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
      </div>
    </main>
  );
}
