// app/routes/customers.$id.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTFileInput } from "~/components/ui/SoTFileInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTPageHeader } from "~/components/ui/SoTPageHeader";
import {
  readOptionalUpload,
  resolveMaxUploadMb,
  uploadKeyPrefix,
  validateImageUpload,
} from "~/features/uploads/upload-policy";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { storage } from "~/utils/storage.server";

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const customerPhotoMaxMb = resolveMaxUploadMb(
    process.env.MAX_CUSTOMER_PHOTO_MB || process.env.MAX_UPLOAD_MB,
    10
  );
  if (!params.id) throw new Response("Missing ID", { status: 400 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return json({ ok: false, error: "Invalid customer ID." }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  if (intent !== "upload-customer-photo") {
    return json({ ok: false, error: "Unsupported action." }, { status: 400 });
  }

  const file = readOptionalUpload(formData.get("customerPhotoFile"));
  if (!file) {
    return json(
      { ok: false, error: "Please choose a customer photo first." },
      { status: 400 }
    );
  }

  const validationError = validateImageUpload(file, customerPhotoMaxMb);
  if (validationError) {
    return json({ ok: false, error: validationError }, { status: 400 });
  }

  try {
    const saved = await storage.save(file, {
      keyPrefix: uploadKeyPrefix.customerProfile(id),
    });

    await db.customer.update({
      where: { id },
      data: {
        photoUrl: saved.url,
        photoKey: saved.key,
        photoUpdatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[customer-profile-photo] upload failed", error);
    return json(
      { ok: false, error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }

  return redirect(`/customers/${id}?ctx=admin`);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const maxCustomerPhotoMb = resolveMaxUploadMb(
    process.env.MAX_CUSTOMER_PHOTO_MB || process.env.MAX_UPLOAD_MB,
    10
  );
  const isAdminCtx = true;
  if (!params.id) throw new Response("Missing ID", { status: 400 });
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
      photoUrl: true,
      photoUpdatedAt: true,
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
      _count: { select: { customerItemPrices: true } },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });

  const arAgg = await db.customerAr.aggregate({
    where: {
      customerId: id,
      balance: { gt: 0 },
      status: { in: ["OPEN", "PARTIALLY_SETTLED"] },
    },
    _sum: { balance: true },
  });

  const name = [customer.firstName, customer.middleName, customer.lastName]
    .filter(Boolean)
    .join(" ");
  const arBalance = Number(arAgg?._sum?.balance ?? 0);
  const rulesCount = customer._count.customerItemPrices;
  const photoUpdatedAtLabel = customer.photoUpdatedAt
    ? new Intl.DateTimeFormat("en-PH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(customer.photoUpdatedAt)
    : null;

  return json({
    customer,
    name,
    arBalance,
    rulesCount,
    isAdminCtx,
    maxCustomerPhotoMb,
    photoUpdatedAtLabel,
  });
}

export default function CustomerProfile() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const {
    customer,
    name,
    arBalance,
    rulesCount,
    maxCustomerPhotoMb,
    photoUpdatedAtLabel,
  } =
    useLoaderData<typeof loader>();
  const ctxSuffix = "?ctx=admin";
  const backHref = "/customers?ctx=admin";
  const uploadBusy =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "upload-customer-photo";

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Customer Profile"
        subtitle="Master record view for pricing and operational setup."
        backTo={backHref}
        backLabel="Customers"
        maxWidthClassName="max-w-5xl"
      />

      <section className="mx-auto max-w-5xl space-y-4 px-5 py-6">
        <SoTPageHeader
          title={name}
          subtitle={
            <>
              {customer.alias ? `(${customer.alias}) • ` : ""}
              {customer.phone || "—"}
            </>
          }
          maxWidthClassName="max-w-none"
          className="py-0"
          actions={
            <>
              <Link
                to={`/customers/${customer.id}/edit${ctxSuffix}`}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Edit
              </Link>
              <Link
                to={`/customers/${customer.id}/pricing${ctxSuffix}`}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Pricing Rules
              </Link>
            </>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <SoTCard interaction="form" className="h-fit space-y-3">
            <div className="text-sm font-medium text-slate-700">Profile Photo</div>
            <div className="flex h-64 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {customer.photoUrl ? (
                <img
                  src={customer.photoUrl}
                  alt={`${name} profile`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="px-3 text-center text-xs text-slate-500">
                  No customer photo uploaded.
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              {photoUpdatedAtLabel
                ? `Last updated: ${photoUpdatedAtLabel}`
                : "No upload record yet."}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Upload / Replace
              </div>
              <Form method="post" encType="multipart/form-data" className="space-y-3">
                <input type="hidden" name="intent" value="upload-customer-photo" />
                <SoTFileInput
                  name="customerPhotoFile"
                  accept="image/jpeg,image/png,image/webp"
                  className="block h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 file:border-0 file:bg-slate-100 hover:file:bg-slate-200"
                />
                <p className="text-xs text-slate-500">
                  JPG, PNG, or WEBP only. Max size: {maxCustomerPhotoMb}MB.
                </p>
                {actionData?.error ? (
                  <SoTAlert tone="danger" className="text-xs">
                    {actionData.error}
                  </SoTAlert>
                ) : null}
                <SoTButton type="submit" variant="primary" disabled={uploadBusy}>
                  {uploadBusy ? "Uploading..." : "Upload Photo"}
                </SoTButton>
              </Form>
            </div>
          </SoTCard>

          <div className="space-y-4">
            <SoTCard>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700">Customer Identity</div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {customer.alias ? `@${customer.alias}` : "No alias"}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <SoTDataRow label="Full Name" value={name || "—"} />
                <SoTDataRow label="First Name" value={customer.firstName || "—"} />
                <SoTDataRow label="Middle Name" value={customer.middleName || "—"} />
                <SoTDataRow label="Last Name" value={customer.lastName || "—"} />
                <SoTDataRow label="Suffix" value={customer.suffix || "—"} />
              </div>
            </SoTCard>

            <SoTCard>
              <div className="mb-3 text-sm font-medium text-slate-700">Contact</div>
              <div className="grid gap-3 md:grid-cols-2">
                <SoTDataRow label="Email" value={customer.email || "—"} />
                <SoTDataRow label="Phone" value={customer.phone || "—"} />
              </div>
            </SoTCard>

            <div className="grid gap-4 md:grid-cols-3">
              <SoTCard compact>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  AR Balance (open)
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums text-slate-900">
                  {peso(arBalance)}
                </div>
              </SoTCard>

              <SoTCard compact>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Credit Limit
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums text-slate-900">
                  {customer.creditLimit == null
                    ? "—"
                    : peso(Number(customer.creditLimit))}
                </div>
              </SoTCard>

              <SoTCard compact>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pricing Rules
                </div>
                <div className="text-lg font-semibold text-slate-900">{rulesCount}</div>
                <Link
                  to={`/customers/${customer.id}/pricing${ctxSuffix}`}
                  className="mt-2 inline-block text-xs text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Manage rules →
                </Link>
              </SoTCard>
            </div>
          </div>
        </div>

        <SoTCard>
          <div className="mb-2 text-sm font-medium text-slate-700">Notes</div>
          <div className="whitespace-pre-wrap text-sm text-slate-700">
            {customer.notes || "—"}
          </div>
        </SoTCard>

        <SoTCard>
          <div className="mb-2 text-sm font-medium text-slate-700">
            Address Location Photos
          </div>
          {customer.addresses.length === 0 ? (
            <p className="text-sm text-slate-600">No address on file.</p>
          ) : (
            <div className="space-y-3">
              {customer.addresses.map((address) => (
                <div
                  key={address.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {address.label} · {address.line1}
                  </div>
                  <div className="mb-2 text-xs text-slate-600">
                    {[address.barangay, address.city, address.province]
                      .filter(Boolean)
                      .join(", ") || "No area snapshot"}
                    {address.landmark ? ` · ${address.landmark}` : ""}
                  </div>
                  {address.photos.length === 0 ? (
                    <p className="text-xs text-slate-500">No location photos yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
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
                            Open photo
                          </a>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {photo.caption || "No caption"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SoTCard>
      </section>
    </main>
  );
}

export const shouldRevalidate = ({
  formMethod,
  defaultShouldRevalidate,
}: {
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}) => {
  if (formMethod && formMethod !== "GET") return true;
  return defaultShouldRevalidate;
};
