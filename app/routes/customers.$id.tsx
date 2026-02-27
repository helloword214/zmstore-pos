// app/routes/customers.$id.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTPageHeader } from "~/components/ui/SoTPageHeader";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { storage } from "~/utils/storage.server";

const MAX_CUSTOMER_PHOTO_MB = Math.max(
  1,
  Number.parseFloat(
    process.env.MAX_CUSTOMER_PHOTO_MB || process.env.MAX_UPLOAD_MB || "10"
  ) || 10
);
const MAX_CUSTOMER_PHOTO_BYTES = Math.floor(MAX_CUSTOMER_PHOTO_MB * 1024 * 1024);
const ALLOWED_CUSTOMER_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function readOptionalUpload(raw: FormDataEntryValue | null): File | null {
  if (!(raw instanceof File)) return null;
  if (!raw.size) return null;
  return raw;
}

function validateCustomerPhotoUpload(file: File) {
  if (!ALLOWED_CUSTOMER_PHOTO_MIME.has(file.type)) {
    return "Only JPG, PNG, and WEBP files are allowed.";
  }
  if (file.size > MAX_CUSTOMER_PHOTO_BYTES) {
    return `File is too large. Limit is ${MAX_CUSTOMER_PHOTO_MB}MB.`;
  }
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
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

  const validationError = validateCustomerPhotoUpload(file);
  if (validationError) {
    return json({ ok: false, error: validationError }, { status: 400 });
  }

  try {
    const saved = await storage.save(file, {
      keyPrefix: `customers/${id}/profile`,
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
      _count: { select: { customerItemPrices: true, orders: true } },
      orders: {
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
        select: { id: true, totalBeforeDiscount: true },
      },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });

  const name = [customer.firstName, customer.middleName, customer.lastName]
    .filter(Boolean)
    .join(" ");
  const arBalance = customer.orders.reduce(
    (s, o) => s + Number(o.totalBeforeDiscount || 0),
    0
  );
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
    maxCustomerPhotoMb: MAX_CUSTOMER_PHOTO_MB,
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

        <SoTCard>
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-700">Customer Photo</div>
              <div className="flex h-52 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
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
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">
                Upload / Replace Profile Photo
              </div>
              <Form method="post" encType="multipart/form-data" className="space-y-3">
                <input type="hidden" name="intent" value="upload-customer-photo" />
                <input
                  type="file"
                  name="customerPhotoFile"
                  accept="image/jpeg,image/png,image/webp"
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
          </div>
        </SoTCard>

        <div className="grid gap-4 md:grid-cols-3">
          <SoTCard>
            <SoTDataRow
              label="AR Balance (open)"
              value={
                <span className="font-mono tabular-nums">{peso(arBalance)}</span>
              }
            />
          </SoTCard>

          <SoTCard>
            <SoTDataRow
              label="Credit Limit"
              value={
                customer.creditLimit == null
                  ? "—"
                  : peso(Number(customer.creditLimit))
              }
            />
          </SoTCard>

          <SoTCard>
            <SoTDataRow label="Active Pricing Rules" value={rulesCount} />
            <Link
              to={`/customers/${customer.id}/pricing${ctxSuffix}`}
              className="mt-2 inline-block text-xs text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Manage rules →
            </Link>
          </SoTCard>
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
