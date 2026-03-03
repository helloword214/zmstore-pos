import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigate,
  useOutlet,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTSectionHeader } from "~/components/ui/SoTSectionHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { db } from "~/utils/db.server";

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return value.slice(0, 10);
}

function formatMoney(value: number | null) {
  if (value == null) return "-";
  return `₱${value.toFixed(2)}`;
}

type ProductActionResult = {
  success?: boolean;
  error?: string;
  action?: "open-pack" | "delete-product" | string;
  id?: number;
};

const PRODUCT_PHOTO_SLOTS = [1, 2, 3, 4] as const;

export async function loader({ params }: LoaderFunctionArgs) {
  const productId = Number(params.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Response("Invalid product ID", { status: 400 });
  }

  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      brand: true,
      unit: true,
      packingUnit: true,
      location: true,
      productIndications: { include: { indication: true } },
      productTargets: { include: { target: true } },
      photos: {
        select: {
          slot: true,
          fileUrl: true,
          uploadedAt: true,
        },
        orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
      },
    },
  });

  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }

  return json({
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      imageTag: product.imageTag,
      isActive: product.isActive,
      allowPackSale: product.allowPackSale,
      categoryName: product.category?.name ?? "-",
      brandName: product.brand?.name ?? "-",
      unitName: product.unit?.name ?? "-",
      packingUnitName: product.packingUnit?.name ?? "-",
      locationName: product.location?.name ?? "-",
      packingSize: asNumber(product.packingSize),
      srp: asNumber(product.srp),
      dealerPrice: asNumber(product.dealerPrice),
      price: asNumber(product.price),
      stock: asNumber(product.stock),
      packingStock: asNumber(product.packingStock),
      minStock: asNumber(product.minStock),
      barcode: product.barcode,
      sku: product.sku,
      expirationDate: product.expirationDate?.toISOString() ?? null,
      replenishAt: product.replenishAt?.toISOString() ?? null,
      indications: product.productIndications.map((entry) => entry.indication.name),
      targets: product.productTargets.map((entry) => entry.target.name),
      photos: product.photos
        .filter((photo, index, list) => {
          const firstIndex = list.findIndex((item) => item.slot === photo.slot);
          return firstIndex === index;
        })
        .map((photo) => ({
          slot: photo.slot,
          fileUrl: photo.fileUrl,
          uploadedAt: photo.uploadedAt.toISOString(),
        })),
    },
  });
}

export default function ProductDetailRoute() {
  const outlet = useOutlet();
  const { product } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const actionFetcher = useFetcher<ProductActionResult>();
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);

  const canOpenPack =
    product.allowPackSale &&
    (product.stock ?? 0) > 0 &&
    (product.packingSize ?? 0) > 0;
  const photoBySlot = useMemo(() => {
    const map = new Map<number, { fileUrl: string; uploadedAt: string }>();
    for (const photo of product.photos ?? []) {
      if (!map.has(photo.slot)) {
        map.set(photo.slot, {
          fileUrl: photo.fileUrl,
          uploadedAt: photo.uploadedAt,
        });
      }
    }
    if (!map.has(1) && product.imageUrl) {
      map.set(1, {
        fileUrl: product.imageUrl,
        uploadedAt: "",
      });
    }
    return map;
  }, [product.photos, product.imageUrl]);

  function handleOpenPack() {
    const packsStr = window.prompt("Open how many whole packs?", "1");
    if (!packsStr) return;

    const packs = Math.max(1, Math.floor(Number(packsStr)));
    if (!Number.isFinite(packs) || packs <= 0) return;

    const form = new FormData();
    form.append("_action", "open-pack");
    form.append("id", String(product.id));
    form.append("packs", String(packs));
    actionFetcher.submit(form, { method: "post", action: "/products" });
  }

  function handleDelete() {
    const confirmed = window.confirm(
      `Delete "${product.name}" permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    const form = new FormData();
    form.append("_action", "delete-product");
    form.append("id", String(product.id));
    form.append("deleteId", String(product.id));
    actionFetcher.submit(form, { method: "post", action: "/products" });
  }

  useEffect(() => {
    if (actionFetcher.state !== "idle" || !actionFetcher.data) return;

    if (actionFetcher.data.success) {
      if (actionFetcher.data.action === "delete-product") {
        navigate("/products");
        return;
      }
      if (actionFetcher.data.action === "open-pack") {
        setMessage({ tone: "success", text: "Stock opened to retail." });
        revalidator.revalidate();
      }
      return;
    }

    if (actionFetcher.data.error) {
      setMessage({ tone: "danger", text: actionFetcher.data.error });
    }
  }, [actionFetcher.state, actionFetcher.data, navigate, revalidator]);

  if (outlet) return outlet;

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="Product Detail"
        subtitle={`Product #${product.id}`}
        backTo="/products"
        backLabel="Product List"
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-6">
        <SoTActionBar
          left={
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {product.name}
              </h2>
              <p className="text-xs text-slate-500">
                {product.brandName} - {product.categoryName}
              </p>
            </div>
          }
          right={
            <>
              <Link
                to="/products"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Back to List
              </Link>
              <Link
                to={`/products/${product.id}/edit`}
                className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Edit Product
              </Link>
            </>
          }
        />

        {message ? (
          <SoTAlert tone={message.tone}>{message.text}</SoTAlert>
        ) : null}

        <SoTCard>
          <SoTSectionHeader title="Operations" />
          <p className="text-sm text-slate-600">
            Run stock conversion and destructive actions from this isolated section.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canOpenPack ? (
              <button
                type="button"
                onClick={handleOpenPack}
                className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Open Pack
              </button>
            ) : (
              <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Open Pack unavailable (requires pack sale, stock, and packing size).
              </span>
            )}

            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition-colors duration-150 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-1"
            >
              Delete Product
            </button>
          </div>
        </SoTCard>

        <SoTCard>
          <SoTSectionHeader title="Commercial and Inventory Snapshot" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SoTDataRow
              label="Status"
              value={
                <SoTStatusBadge tone={product.isActive ? "success" : "danger"}>
                  {product.isActive ? "Active" : "Inactive"}
                </SoTStatusBadge>
              }
            />
            <SoTDataRow
              label="Selling Mode"
              value={
                <SoTStatusBadge tone={product.allowPackSale ? "info" : "neutral"}>
                  {product.allowPackSale ? "PACK + RETAIL" : "PACK only"}
                </SoTStatusBadge>
              }
            />
            <SoTDataRow label="Unit" value={product.unitName} />
            <SoTDataRow label="Packing Unit" value={product.packingUnitName} />
            <SoTDataRow
              label="Packing Size"
              value={product.packingSize == null ? "-" : String(product.packingSize)}
            />
            <SoTDataRow label="Whole Price" value={formatMoney(product.srp)} />
            <SoTDataRow label="Retail Price" value={formatMoney(product.price)} />
            <SoTDataRow label="Cost Price" value={formatMoney(product.dealerPrice)} />
            <SoTDataRow
              label="Whole Stock"
              value={product.stock == null ? "-" : String(product.stock)}
            />
            <SoTDataRow
              label="Retail Stock"
              value={product.packingStock == null ? "-" : String(product.packingStock)}
            />
            <SoTDataRow
              label="Min Stock"
              value={product.minStock == null ? "-" : String(product.minStock)}
            />
            <SoTDataRow label="Location" value={product.locationName} />
            <SoTDataRow label="Barcode" value={product.barcode || "-"} />
            <SoTDataRow label="SKU" value={product.sku || "-"} />
            <SoTDataRow label="Expiration" value={formatDate(product.expirationDate)} />
            <SoTDataRow label="Replenish At" value={formatDate(product.replenishAt)} />
          </div>
        </SoTCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <SoTCard>
            <SoTSectionHeader title="Indications" />
            {product.indications.length ? (
              <div className="flex flex-wrap gap-2">
                {product.indications.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <SoTEmptyState title="No indications assigned." className="px-0 py-2 text-left" />
            )}
          </SoTCard>

          <SoTCard>
            <SoTSectionHeader title="Targets" />
            {product.targets.length ? (
              <div className="flex flex-wrap gap-2">
                {product.targets.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <SoTEmptyState title="No targets assigned." className="px-0 py-2 text-left" />
            )}
          </SoTCard>
        </div>

        <SoTCard>
          <SoTSectionHeader title="Description" />
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {product.description || "-"}
          </p>
        </SoTCard>

        <SoTCard>
          <SoTSectionHeader title="Photos (max 4)" />
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PRODUCT_PHOTO_SLOTS.map((slot) => {
                const current = photoBySlot.get(slot);
                return (
                  <div
                    key={slot}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Slot {slot}
                    </div>
                    {current?.fileUrl ? (
                      <img
                        src={current.fileUrl}
                        alt={`${product.name} slot ${slot}`}
                        className="mb-2 h-24 w-24 rounded border object-cover"
                      />
                    ) : (
                      <div className="mb-2 h-24 w-24 rounded border border-dashed text-xs text-slate-400 grid place-items-center">
                        Empty
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {product.imageTag ? (
              <div className="mt-2 text-xs text-slate-500">Tag: {product.imageTag}</div>
            ) : null}
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
