import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  EmployeeDocumentType,
  ManagerKind,
  Prisma,
  UserRole,
} from "@prisma/client";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import * as React from "react";
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

function parseEmployeeId(raw: string | undefined) {
  const id = Number(raw || "");
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.floor(id);
}

function toLane(role: UserRole): Lane {
  if (role === UserRole.CASHIER) return "CASHIER";
  if (role === UserRole.STORE_MANAGER) return "STORE_MANAGER";
  return "RIDER";
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

function formatDateForInput(date: string | Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

function prettyLane(lane: Lane, managerKind: ManagerKind | null) {
  if (lane !== "STORE_MANAGER") return lane;
  return managerKind ? `STORE_MANAGER (${managerKind})` : "STORE_MANAGER";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const employeeId = parseEmployeeId(params.employeeId);
  if (!employeeId) {
    throw json({ message: "Invalid employee id." }, { status: 400 });
  }

  const [employee, vehicles, provinces, municipalities, barangays, zones, landmarks] =
    await Promise.all([
      db.employee.findUnique({
        where: { id: employeeId },
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
              id: true,
              line1: true,
              provinceId: true,
              municipalityId: true,
              barangayId: true,
              zoneId: true,
              landmarkId: true,
              purok: true,
              postalCode: true,
              landmark: true,
            },
          },
          documents: {
            select: {
              id: true,
              docType: true,
              fileUrl: true,
              mimeType: true,
              sizeBytes: true,
              expiresAt: true,
              uploadedAt: true,
              uploadedBy: {
                select: { id: true, email: true },
              },
            },
            orderBy: { uploadedAt: "desc" },
            take: 50,
          },
        },
      }),
      db.vehicle.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
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

  if (!employee || !employee.user) {
    throw json({ message: "Employee not found." }, { status: 404 });
  }

  const lane = toLane(employee.user.role);

  return json({
    employee,
    lane,
    vehicles,
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

  if (intent !== "update-profile") {
    return json<ActionData>({ ok: false, message: "Unknown intent." }, { status: 400 });
  }

  const employeeId = parseEmployeeId(String(fd.get("employeeId") || ""));
  if (!employeeId) {
    return json<ActionData>({ ok: false, message: "Invalid employee id." }, { status: 400 });
  }

  const existing = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          managerKind: true,
        },
      },
      address: {
        select: { id: true },
      },
    },
  });

  if (!existing || !existing.user) {
    return json<ActionData>({ ok: false, message: "Employee not found." }, { status: 404 });
  }

  const lane = toLane(existing.user.role);

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
    await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
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
          defaultVehicleId: lane === "RIDER" ? defaultVehicleId || null : null,
        },
      });

      await tx.user.update({
        where: { id: existing.user!.id },
        data: { email },
      });

      const addressData = {
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
      };

      if (existing.address?.id) {
        await tx.employeeAddress.update({
          where: { id: existing.address.id },
          data: addressData,
        });
      } else {
        await tx.employeeAddress.create({
          data: {
            employeeId,
            ...addressData,
          },
        });
      }
    });

    let uploadedDocCount = 0;
    const docUploadFailures: string[] = [];
    for (const doc of docsToUpload) {
      try {
        const saved = await storage.save(doc.file, {
          keyPrefix: `employees/${employeeId}/${doc.docType.toLowerCase()}`,
        });
        await db.employeeDocument.create({
          data: {
            employeeId,
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

    const uploadedMsg =
      uploadedDocCount > 0 ? ` ${uploadedDocCount} document(s) uploaded.` : "";
    const failedMsg = docUploadFailures.length
      ? ` Upload failed for: ${docUploadFailures.join(", ")}.`
      : "";

    return json<ActionData>({
      ok: true,
      message: `Employee profile updated.${uploadedMsg}${failedMsg}`,
    });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return json<ActionData>(
        { ok: false, message: "Duplicate value detected (email or phone already exists)." },
        { status: 400 },
      );
    }
    const message = e instanceof Error ? e.message : "Employee update failed.";
    return json<ActionData>({ ok: false, message }, { status: 500 });
  }
}

export default function EmployeeEditPage() {
  const {
    employee,
    lane,
    vehicles,
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const initialProvince = employee.address?.provinceId ?? provinces[0]?.id ?? "";
  const initialMunicipality =
    employee.address?.municipalityId ??
    municipalities.find((m) => m.provinceId === initialProvince)?.id ??
    "";
  const initialBarangay =
    employee.address?.barangayId ??
    barangays.find((b) => b.municipalityId === initialMunicipality)?.id ??
    "";

  const [provinceId, setProvinceId] = React.useState<number | "">(initialProvince);
  const [municipalityId, setMunicipalityId] = React.useState<number | "">(initialMunicipality);
  const [barangayId, setBarangayId] = React.useState<number | "">(initialBarangay);
  const [zoneId, setZoneId] = React.useState<number | "">(employee.address?.zoneId ?? "");
  const [landmarkId, setLandmarkId] = React.useState<number | "">(
    employee.address?.landmarkId ?? "",
  );

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
        title={`Edit Employee - ${employee.firstName} ${employee.lastName}`}
        subtitle="Update profile, address, and compliance records."
        backTo="/creation/employees"
        backLabel="Employee Directory"
        maxWidthClassName="max-w-7xl"
      />

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {actionData ? (
          <SoTAlert tone={actionData.ok ? "success" : "danger"}>{actionData.message}</SoTAlert>
        ) : null}

        <SoTCard className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Lane</p>
            <p className="text-sm font-semibold text-slate-900">
              {prettyLane(lane, employee.user?.managerKind ?? null)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Account State</p>
            <p className="text-sm font-semibold text-slate-900">
              {employee.user?.active ? "ACTIVE" : "INACTIVE"} · {employee.user?.authState}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Login Email</p>
            <p className="text-sm font-semibold text-slate-900">{employee.user?.email ?? "-"}</p>
          </div>
        </SoTCard>

        <SoTCard>
          <Form
            method="post"
            encType="multipart/form-data"
            className={busy ? "pointer-events-none opacity-70" : ""}
          >
            <input type="hidden" name="intent" value="update-profile" />
            <input type="hidden" name="employeeId" value={employee.id} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Identity and Compliance</h3>
                  <p className="text-xs text-slate-500">
                    Lane is controlled by account role; this page updates profile and compliance data.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SoTInput name="firstName" label="First Name" defaultValue={employee.firstName} required />
                  <SoTInput
                    name="middleName"
                    label="Middle Name (optional)"
                    defaultValue={employee.middleName ?? ""}
                  />
                  <SoTInput name="lastName" label="Last Name" defaultValue={employee.lastName} required />
                  <SoTInput name="alias" label="Alias (optional)" defaultValue={employee.alias ?? ""} />
                  <SoTInput
                    name="birthDate"
                    label="Birth Date (optional)"
                    type="date"
                    defaultValue={formatDateForInput(employee.birthDate)}
                  />
                  <SoTInput
                    name="phone"
                    label="Phone"
                    inputMode="numeric"
                    required
                    defaultValue={employee.phone ?? ""}
                  />
                  <SoTInput
                    name="email"
                    label="Email"
                    type="email"
                    required
                    defaultValue={employee.user?.email ?? employee.email ?? ""}
                  />
                  <SoTInput
                    name="sssNumber"
                    label="SSS Number (optional)"
                    defaultValue={employee.sssNumber ?? ""}
                  />
                  <SoTInput
                    name="pagIbigNumber"
                    label="Pag-IBIG Number (optional)"
                    defaultValue={employee.pagIbigNumber ?? ""}
                  />
                  <SoTInput
                    name="licenseNumber"
                    label="License Number (optional)"
                    defaultValue={employee.licenseNumber ?? ""}
                  />
                  <SoTInput
                    name="licenseExpiry"
                    label="License Expiry (optional)"
                    type="date"
                    defaultValue={formatDateForInput(employee.licenseExpiry)}
                  />

                  <SoTFormField
                    label="Default Vehicle (Rider lane)"
                    hint={lane === "RIDER" ? "Used for rider assignment defaults." : "Ignored for non-rider lanes."}
                  >
                    <select
                      name="defaultVehicleId"
                      defaultValue={employee.defaultVehicleId ?? ""}
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
                    Maintain canonical province to municipality to barangay hierarchy.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SoTInput name="line1" label="House/Street" defaultValue={employee.address?.line1 ?? ""} required />
                  <SoTInput name="purok" label="Purok (text, optional)" defaultValue={employee.address?.purok ?? ""} />
                  <SoTInput
                    name="postalCode"
                    label="Postal Code (optional)"
                    defaultValue={employee.address?.postalCode ?? ""}
                  />
                  <SoTInput
                    name="landmarkText"
                    label="Landmark (text, optional)"
                    defaultValue={employee.address?.landmark ?? ""}
                  />

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
                <h3 className="text-sm font-semibold text-slate-900">Add Compliance Documents</h3>
                <p className="text-xs text-slate-500">
                  New uploads append to history. Existing files are kept for audit.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Monitoring-only: missing files never block profile updates or role switching.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                <SoTInput name="validIdExpiry" label="Valid ID Expiry (optional)" type="date" />
                <SoTInput
                  name="driverLicenseScanExpiry"
                  label="Driver License Scan Expiry (optional)"
                  type="date"
                />

                <SoTFormField label="Barangay Clearance Scan (optional)" hint="No expiry tracking.">
                  <input
                    type="file"
                    name="barangayClearanceFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="Valid ID Scan (optional)">
                  <input
                    type="file"
                    name="validIdFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="Driver License Scan (optional)">
                  <input
                    type="file"
                    name="driverLicenseFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="Police Clearance Scan (optional)" hint="No expiry tracking.">
                  <input
                    type="file"
                    name="policeClearanceFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="NBI Clearance Scan (optional)" hint="No expiry tracking.">
                  <input
                    type="file"
                    name="nbiClearanceFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="2x2 Photo (optional)">
                  <input
                    type="file"
                    name="photo2x2File"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>

                <SoTFormField label="Resume (optional)">
                  <input
                    type="file"
                    name="resumeFile"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </SoTFormField>
              </div>
            </section>

            <div className="mt-4 flex justify-end">
              <SoTButton variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save Employee Profile"}
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <SoTCard>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Document Upload History
          </div>
          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Type</SoTTh>
                <SoTTh>Uploaded At</SoTTh>
                <SoTTh>Expiry</SoTTh>
                <SoTTh>File</SoTTh>
                <SoTTh>By</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {employee.documents.length === 0 ? (
                <SoTTableEmptyRow colSpan={5} message="No compliance documents uploaded yet." />
              ) : (
                employee.documents.map((doc) => (
                  <SoTTableRow key={doc.id}>
                    <SoTTd>{doc.docType}</SoTTd>
                    <SoTTd>{new Date(doc.uploadedAt).toLocaleString()}</SoTTd>
                    <SoTTd>{doc.expiresAt ? formatDateForInput(doc.expiresAt) : "-"}</SoTTd>
                    <SoTTd>
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-indigo-700 underline"
                      >
                        Open file ({doc.mimeType}, {Math.round(doc.sizeBytes / 1024)} KB)
                      </a>
                    </SoTTd>
                    <SoTTd>{doc.uploadedBy?.email ?? "System"}</SoTTd>
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
