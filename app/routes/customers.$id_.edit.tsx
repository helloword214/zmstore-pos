// app/routes/customers.$id_.edit.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { storage } from "~/utils/storage.server";

type AddressPhotoUpload = {
  addressId: number;
  slot: number;
  caption: string | null;
  file: File;
};

const MAX_ADDRESS_PHOTO_MB = Math.max(
  1,
  Number.parseFloat(
    process.env.MAX_ADDRESS_PHOTO_MB || process.env.MAX_UPLOAD_MB || "10"
  ) || 10
);
const MAX_ADDRESS_PHOTO_BYTES = Math.floor(MAX_ADDRESS_PHOTO_MB * 1024 * 1024);
const ALLOWED_ADDRESS_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function readOptionalUpload(raw: FormDataEntryValue | null): File | null {
  if (!(raw instanceof File)) return null;
  if (!raw.size) return null;
  return raw;
}

function validateAddressPhotoUpload(file: File) {
  if (!ALLOWED_ADDRESS_PHOTO_MIME.has(file.type)) {
    return "Only JPG, PNG, and WEBP files are allowed.";
  }
  if (file.size > MAX_ADDRESS_PHOTO_BYTES) {
    return `File is too large. Limit is ${MAX_ADDRESS_PHOTO_MB}MB.`;
  }
  return null;
}

function parseAddressPhotoUploads(formData: FormData, addressIds: number[]) {
  const uploads: AddressPhotoUpload[] = [];
  for (const addressId of addressIds) {
    for (let slot = 1; slot <= 4; slot += 1) {
      const file = readOptionalUpload(formData.get(`addrPhotoFile_${addressId}_${slot}`));
      if (!file) continue;
      const captionRaw = String(
        formData.get(`addrPhotoCaption_${addressId}_${slot}`) || ""
      ).trim();
      uploads.push({
        addressId,
        slot,
        caption: captionRaw || null,
        file,
      });
    }
  }
  return uploads;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const ctx = "admin";
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      suffix: true,
      alias: true,
      phone: true,
      email: true,
      creditLimit: true,
      notes: true,
      addresses: {
        select: {
          id: true,
          label: true,
          line1: true,
          barangay: true,
          city: true,
          province: true,
          landmark: true,
          photos: {
            select: {
              id: true,
              slot: true,
              fileUrl: true,
              caption: true,
              uploadedAt: true,
            },
            orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
          },
        },
        orderBy: [{ id: "asc" }],
      },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });
  return json({ customer, ctx });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });
  }

  const fd = await request.formData();
  const firstName = String(fd.get("firstName") || "").trim();
  const middleName = (String(fd.get("middleName") || "").trim() || null) as
    | string
    | null;
  const lastName = String(fd.get("lastName") || "").trim();
  const suffix = (String(fd.get("suffix") || "").trim() || null) as
    | string
    | null;
  const alias = (String(fd.get("alias") || "").trim() || null) as string | null;
  const phone = (String(fd.get("phone") || "").trim() || null) as string | null;
  const email = (String(fd.get("email") || "").trim() || null) as string | null;
  const creditLimitRaw = fd.get("creditLimit");
  const creditLimit =
    creditLimitRaw === null || String(creditLimitRaw).trim() === ""
      ? null
      : Number(creditLimitRaw);
  const notes = (String(fd.get("notes") || "").trim() || null) as string | null;

  const errors: Record<string, string> = {};
  if (!firstName) errors.firstName = "Required";
  if (!lastName) errors.lastName = "Required";
  if (creditLimit !== null && !Number.isFinite(creditLimit)) {
    errors.creditLimit = "Enter a number";
  }

  const addressRows = await db.customerAddress.findMany({
    where: { customerId: id },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const addressIds = addressRows.map((a) => a.id);

  const photoUploads = parseAddressPhotoUploads(fd, addressIds);
  for (const upload of photoUploads) {
    const photoError = validateAddressPhotoUpload(upload.file);
    if (photoError) {
      return json(
        {
          ok: false,
          error: `Address #${upload.addressId} photo slot ${upload.slot}: ${photoError}`,
        },
        { status: 400 }
      );
    }
  }

  if (Object.keys(errors).length) {
    return json({ ok: false, errors }, { status: 400 });
  }

  await db.customer.update({
    where: { id },
    data: {
      firstName,
      middleName,
      lastName,
      suffix,
      alias,
      phone,
      email,
      creditLimit,
      notes,
    },
  });

  const updatedAddressIds = new Set<number>();
  for (const upload of photoUploads) {
    try {
      const saved = await storage.save(upload.file, {
        keyPrefix: `customers/${id}/addresses/${upload.addressId}/photos`,
      });
      await db.customerAddressPhoto.upsert({
        where: {
          customerAddressId_slot: {
            customerAddressId: upload.addressId,
            slot: upload.slot,
          },
        },
        create: {
          customerAddressId: upload.addressId,
          slot: upload.slot,
          fileKey: saved.key,
          fileUrl: saved.url,
          mimeType: saved.contentType,
          sizeBytes: saved.size,
          caption: upload.caption?.slice(0, 160) || null,
        },
        update: {
          fileKey: saved.key,
          fileUrl: saved.url,
          mimeType: saved.contentType,
          sizeBytes: saved.size,
          caption: upload.caption?.slice(0, 160) || null,
          uploadedAt: new Date(),
        },
      });
      updatedAddressIds.add(upload.addressId);
    } catch (error) {
      console.error("[customer-address-photo] edit upload failed", error);
    }
  }

  for (const addressId of updatedAddressIds) {
    const cover = await db.customerAddressPhoto.findFirst({
      where: { customerAddressId: addressId },
      orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
      select: { fileUrl: true, fileKey: true },
    });
    await db.customerAddress.update({
      where: { id: addressId },
      data: {
        photoUrl: cover?.fileUrl ?? null,
        photoKey: cover?.fileKey ?? null,
        photoUpdatedAt: cover ? new Date() : null,
      },
    });
  }

  return redirect(`/customers/${id}?ctx=admin`);
}

export default function EditCustomer() {
  const { customer } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();
  const backHref = `/customers/${customer.id}?ctx=admin`;
  const fieldErrors = actionData && "errors" in actionData ? actionData.errors : undefined;
  const formError = actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Edit Customer"
        subtitle={[customer.firstName, customer.lastName].filter(Boolean).join(" ")}
        backTo={backHref}
        backLabel="Customer Profile"
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto max-w-5xl px-5 py-6">
        {formError ? (
          <SoTAlert tone="danger" className="mb-3">
            {formError}
          </SoTAlert>
        ) : null}

        <SoTCard interaction="form">
          <Form method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
            <SoTFormField label="First Name" error={fieldErrors?.firstName}>
              <input
                name="firstName"
                defaultValue={customer.firstName ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Middle Name">
              <input
                name="middleName"
                defaultValue={customer.middleName ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Last Name" error={fieldErrors?.lastName}>
              <input
                name="lastName"
                defaultValue={customer.lastName ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Suffix">
              <input
                name="suffix"
                defaultValue={customer.suffix ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Alias">
              <input
                name="alias"
                defaultValue={customer.alias ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Phone">
              <input
                name="phone"
                defaultValue={customer.phone ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Email">
              <input
                name="email"
                defaultValue={customer.email ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Credit Limit (PHP)" error={fieldErrors?.creditLimit}>
              <input
                name="creditLimit"
                type="number"
                step="0.01"
                min="0"
                defaultValue={customer.creditLimit ?? ""}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <SoTFormField label="Notes" className="sm:col-span-2">
              <textarea
                name="notes"
                rows={4}
                defaultValue={customer.notes ?? ""}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              />
            </SoTFormField>

            <div className="sm:col-span-2 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Address Location Photos
              </div>
              {customer.addresses.length === 0 ? (
                <SoTAlert tone="info">No customer address found yet.</SoTAlert>
              ) : (
                customer.addresses.map((address) => {
                  return (
                    <div key={address.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-1 text-sm font-semibold text-slate-900">
                        {address.label} · {address.line1}
                      </div>
                      <div className="mb-2 text-xs text-slate-600">
                        {[address.barangay, address.city, address.province]
                          .filter(Boolean)
                          .join(", ") || "No area snapshot"}
                        {address.landmark ? ` · ${address.landmark}` : ""}
                      </div>

                      {address.photos.length > 0 ? (
                        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                          {address.photos.map((photo) => (
                            <div
                              key={photo.id}
                              className="rounded-lg border border-slate-200 bg-white p-2"
                            >
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                Slot {photo.slot}
                              </div>
                              <a
                                href={photo.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-indigo-700 underline"
                              >
                                Open current photo
                              </a>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {photo.caption || "No caption"}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mb-3 text-[11px] text-slate-500">
                          No location photos yet for this address.
                        </p>
                      )}

                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {[1, 2, 3, 4].map((slot) => {
                          const current = address.photos.find((p) => p.slot === slot);
                          return (
                            <div
                              key={`address-${address.id}-slot-${slot}`}
                              className="rounded-lg border border-slate-200 bg-white p-2"
                            >
                              <SoTFormField label={`Slot ${slot} photo (optional)`}>
                                <input
                                  type="file"
                                  name={`addrPhotoFile_${address.id}_${slot}`}
                                  accept="image/jpeg,image/png,image/webp"
                                  className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                                />
                              </SoTFormField>
                              <SoTFormField label="Caption (optional)">
                                <input
                                  name={`addrPhotoCaption_${address.id}_${slot}`}
                                  defaultValue={current?.caption ?? ""}
                                  placeholder="ex: Kanto view / Gate color"
                                  className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                                />
                              </SoTFormField>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="sm:col-span-2">
              <SoTActionBar
                className="mb-0"
                right={
                  <>
                    <Link
                      to={backHref}
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    >
                      Cancel
                    </Link>
                    <SoTButton
                      type="submit"
                      variant="primary"
                      disabled={nav.state !== "idle"}
                    >
                      {nav.state !== "idle" ? "Saving..." : "Save Changes"}
                    </SoTButton>
                  </>
                }
              />
            </div>
          </Form>
        </SoTCard>
      </div>
    </main>
  );
}

// UI-only page; keep data stable
export const shouldRevalidate = () => false;
