import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { storage } from "~/utils/storage.server";
import {
  useLoaderData,
  useFetcher,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useRef, useState, useMemo } from "react";
import type { LoaderData, ProductWithDetails } from "~/types";
import { db } from "~/utils/db.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { ProductsListTable } from "~/components/products/ProductsListTable";
import { Pagination } from "~/components/ui/Pagination";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
import { SoTLinkButton } from "~/components/ui/SoTLinkButton";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTSearchInput } from "~/components/ui/SoTSearchInput";
import {
  createUploadSessionKey,
  MAX_PRODUCT_PHOTO_SLOTS,
  mbToBytes,
  normalizeProductPhotoSlot,
  readOptionalUpload,
  resolveUploadSessionKey,
  resolveMaxUploadMb,
  uploadKeyPrefix,
  validateImageUpload,
} from "~/features/uploads/upload-policy";
import { runProductUpsertAction } from "~/features/products/product-upsert-action.server";
import { clsx } from "clsx";
import { Toast } from "~/components/ui/Toast";
import { requireRole } from "~/utils/auth.server";

type SortBy = "recent" | "name-asc" | "price-asc" | "price-desc" | "stock-asc";

type StatusFilter = "all" | "active" | "inactive";
type ProductActionType =
  | "created"
  | "updated"
  | "deleted"
  | "toggled"
  | "open-pack"
  | "delete-product";

type ProductActionResult = {
  success?: boolean;
  error?: string;
  field?: string;
  action?: ProductActionType | string;
  id?: number;
  imageUrl?: string;
};

type ProductPhotoUpload = {
  slot: number;
  file: File;
};

type SavedProductPhotoUpload = {
  slot: number;
  fileKey: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
};

type FetcherFormCarrier = {
  submission?: { formData?: FormData } | null;
  formData?: FormData | null;
};

function extractSubmittedForm(fetcher: unknown): FormData | undefined {
  if (!fetcher || typeof fetcher !== "object") {
    return undefined;
  }
  const carrier = fetcher as FetcherFormCarrier;
  return carrier.submission?.formData ?? carrier.formData ?? undefined;
}

function createdAtMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}

function collectProductPhotoUploads(
  formData: FormData,
  actionType: string | undefined,
  legacyImageFile: File | null
): ProductPhotoUpload[] {
  const bySlot = new Map<number, File>();
  for (let slot = 1; slot <= MAX_PRODUCT_PHOTO_SLOTS; slot += 1) {
    const file = readOptionalUpload(formData.get(`productPhotoFile_${slot}`));
    if (file) {
      bySlot.set(slot, file);
    }
  }

  const requestedSlot = normalizeProductPhotoSlot(formData.get("slot")?.toString());
  if (actionType === "upload-product-photo-slot") {
    if (requestedSlot && legacyImageFile) {
      bySlot.set(requestedSlot, legacyImageFile);
    }
    return Array.from(bySlot.entries())
      .sort(([a], [b]) => a - b)
      .map(([slot, file]) => ({ slot, file }));
  }

  if ((actionType === "upload-product-image" || !actionType) && legacyImageFile) {
    if (!bySlot.has(1)) {
      bySlot.set(1, legacyImageFile);
    }
  }

  return Array.from(bySlot.entries())
    .sort(([a], [b]) => a - b)
    .map(([slot, file]) => ({ slot, file }));
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const [
    products,
    categories,
    brands,
    units,
    packingUnits,
    indications,
    locations,
  ] = await Promise.all([
    db.product.findMany({
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
      orderBy: { createdAt: "desc" },
    }),
    db.category.findMany(),
    db.brand.findMany(),
    db.unit.findMany(),
    db.packingUnit.findMany(),
    db.indication.findMany({
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    db.location.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  // Flatten the join tables into simple name arrays
  const productsWithDetails = products.map((p) => {
    const { photos, ...productRow } = p;
    const uniquePhotos = photos.filter((photo, index, list) => {
      const firstIndex = list.findIndex((item) => item.slot === photo.slot);
      return firstIndex === index;
    });

    return {
      ...productRow,
      imageUrl: uniquePhotos[0]?.fileUrl ?? null,

      // Retail unit
      unitId: p.unit?.id ?? null,
      unitName: p.unit?.name ?? "",

      // Packing unit (container)
      packingUnitId: p.packingUnit?.id ?? null,
      packingUnitName: p.packingUnit?.name ?? "",

      // Storage location
      locationId: p.location?.id ?? null,
      locationName: p.location?.name ?? "",

      // Tags and relations
      indications: p.productIndications.map((pi) => ({
        id: pi.indication.id,
        name: pi.indication.name,
      })),
      targets: (() => {
        const seen = new Set<string>();
        return p.productTargets
          .map((pt) => pt.target)
          .filter((t) => {
            const key = String(t.id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((t) => ({ id: t.id, name: t.name }));
      })(),
    };
  });

  const targetsForFilter: {
    id: number;
    name: string;
    categoryId: number | null;
    brandId: number | null;
  }[] = [];

  const seen = new Set<string>();

  for (const p of productsWithDetails) {
    const cId = p.categoryId ?? null;
    const bId = p.brandId ?? null;

    for (const t of p.targets ?? []) {
      const key = `${t.id}::${cId ?? "null"}::${bId ?? "null"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      targetsForFilter.push({
        id: t.id,
        name: t.name,
        categoryId: cId,
        brandId: bId,
      });
    }
  }

  return json({
    products: productsWithDetails,
    categories,
    brands,
    units,
    packingUnits,
    indications,
    targets: targetsForFilter,
    locations,
    storeCode: process.env.STORE_CODE ?? "00",
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireRole(request, ["ADMIN"]);
  const formData = await request.formData();
  const toggleId = formData.get("toggleId");
  const newIsActive = formData.get("isActive");
  const actionType = formData.get("_action")?.toString();

  // Common fields
  const id = formData.get("id")?.toString();
  const uploadSessionKey =
    resolveUploadSessionKey(formData.get("uploadSessionKey")?.toString()) ??
    createUploadSessionKey();
  const imageFile = readOptionalUpload(formData.get("imageFile"));
  const requestedSlot = normalizeProductPhotoSlot(formData.get("slot")?.toString());
  const productPhotoUploads = collectProductPhotoUploads(formData, actionType, imageFile);

  // if updating, load existing photos so we can clean up on replace
  const existingProduct = id
    ? await db.product.findUnique({
        where: { id: Number(id) },
        select: {
          photos: {
            select: {
              slot: true,
              fileKey: true,
              fileUrl: true,
            },
            orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
          },
        },
      })
    : null;

  let finalImageUrl: string | undefined;

  // Delete product action

  if (actionType === "delete-product") {
    const idStr =
      formData.get("id")?.toString() ?? formData.get("deleteId")?.toString();

    if (!idStr) {
      return json(
        { success: false, error: "Missing product id." },
        { status: 400 }
      );
    }

    await db.product.delete({ where: { id: Number(idStr) } });

    return json({ success: true, action: "delete-product", id: Number(idStr) });
  }

  const processedPhotoUploads: SavedProductPhotoUpload[] = [];
  if (productPhotoUploads.length > 0) {
    const { default: sharp } = await import("sharp");
    const maxMb = resolveMaxUploadMb(
      process.env.MAX_PRODUCT_IMAGE_MB || process.env.MAX_UPLOAD_MB,
      20
    );
    const maxBytes = mbToBytes(maxMb);

    for (const upload of productPhotoUploads) {
      const validationError = validateImageUpload(upload.file, maxMb);
      if (validationError) {
        return json(
          {
            success: false,
            error: `Photo slot ${upload.slot}: ${validationError}`,
          },
          { status: 400 }
        );
      }

      const fileSize = Number(upload.file.size) || 0;
      if (fileSize > maxBytes) {
        return json(
          {
            success: false,
            error: `Photo slot ${upload.slot}: image too large (>${maxMb}MB). Received ${fileSize} bytes.`,
          },
          { status: 400 }
        );
      }

      try {
        const input = Buffer.from(await upload.file.arrayBuffer());
        const webp = await sharp(input)
          .rotate()
          .resize({
            width: 1920,
            height: 1920,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toBuffer();

        const saved = await storage.saveBuffer(webp, {
          ext: "webp",
          contentType: "image/webp",
          keyPrefix: uploadKeyPrefix.productPhotoSlot({
            productId: id ? Number(id) : null,
            uploadSessionKey,
            slot: upload.slot,
          }),
        });
        processedPhotoUploads.push({
          slot: upload.slot,
          fileKey: saved.key,
          fileUrl: saved.url,
          mimeType: saved.contentType,
          sizeBytes: saved.size,
        });
      } catch (error) {
        console.error("[image] processing failed", error);
        return json(
          {
            success: false,
            error: `Photo slot ${upload.slot}: failed to process image.`,
          },
          { status: 400 }
        );
      }
    }
  }

  if (processedPhotoUploads.length > 0) {
    const coverUpload = [...processedPhotoUploads].sort((a, b) => a.slot - b.slot)[0];
    finalImageUrl = coverUpload?.fileUrl ?? finalImageUrl;
  }

  const persistProductPhotos = async (
    productId: number,
    previousPhotos: Array<{ slot: number; fileKey: string; fileUrl: string }>
  ) => {
    const replacedKeys: string[] = [];
    const previousBySlot = new Map(previousPhotos.map((photo) => [photo.slot, photo]));

    for (const upload of processedPhotoUploads) {
      const previous = previousBySlot.get(upload.slot);
      await db.productPhoto.upsert({
        where: {
          productId_slot: {
            productId,
            slot: upload.slot,
          },
        },
        create: {
          productId,
          slot: upload.slot,
          fileKey: upload.fileKey,
          fileUrl: upload.fileUrl,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
        },
        update: {
          fileKey: upload.fileKey,
          fileUrl: upload.fileUrl,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          uploadedAt: new Date(),
        },
      });

      if (previous?.fileKey && previous.fileKey !== upload.fileKey) {
        replacedKeys.push(previous.fileKey);
      }
    }

    const cover = await db.productPhoto.findFirst({
      where: { productId },
      orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
      select: { fileUrl: true, fileKey: true },
    });

    return { cover, replacedKeys };
  };

  if (
    actionType === "upload-product-image" ||
    actionType === "upload-product-photo-slot"
  ) {
    const idStr = formData.get("id")?.toString();
    const productId = Number(idStr || 0);

    if (!idStr || !Number.isFinite(productId) || productId <= 0) {
      return json(
        { success: false, error: "Missing or invalid product id." },
        { status: 400 }
      );
    }

    if (actionType === "upload-product-photo-slot" && requestedSlot == null) {
      return json(
        { success: false, error: "Invalid photo slot. Allowed slots are 1 to 4." },
        { status: 400 }
      );
    }

    if (processedPhotoUploads.length <= 0) {
      return json(
        { success: false, error: "Please choose a photo to upload." },
        { status: 400 }
      );
    }

    if (!existingProduct) {
      return json(
        { success: false, error: "Product not found." },
        { status: 404 }
      );
    }

    const persisted = await persistProductPhotos(productId, existingProduct.photos ?? []);
    const coverImageUrl = persisted.cover?.fileUrl ?? null;

    const keysToDelete = new Set(persisted.replacedKeys);

    for (const oldKey of keysToDelete) {
      try {
        await storage.delete(oldKey);
      } catch (error) {
        console.warn("delete old image failed", error);
      }
    }

    finalImageUrl = coverImageUrl ?? finalImageUrl;

    return json({
      success: true,
      action: "upload-product-photo-slot",
      id: productId,
      ...(finalImageUrl !== undefined ? { imageUrl: finalImageUrl } : {}),
    });
  }

  if (actionType === "open-pack") {
    const idStr = formData.get("id")?.toString();
    const packsStr = formData.get("packs")?.toString() || "1";
    const packs = Math.max(1, Math.floor(Number(packsStr || "1")));

    if (!idStr || !Number.isFinite(packs) || packs <= 0) {
      return json(
        { success: false, error: "Invalid unpack request." },
        { status: 400 }
      );
    }

    const id = Number(idStr);
    const prod = await db.product.findUnique({
      where: { id },
      select: {
        stock: true,
        packingSize: true,
        allowPackSale: true,
        packingStock: true,
      },
    });
    if (!prod)
      return json(
        { success: false, error: "Product not found." },
        { status: 404 }
      );
    if (!prod.allowPackSale) {
      return json(
        { success: false, error: "Retail sale not enabled for this product." },
        { status: 400 }
      );
    }
    const packingSize = Number(prod.packingSize ?? 0);
    const wholeStock = Number(prod.stock ?? 0);

    if (!Number.isFinite(packingSize) || packingSize <= 0) {
      return json(
        { success: false, error: "Packing size is not set." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(wholeStock) || wholeStock < packs) {
      return json(
        { success: false, error: "Not enough whole stock to open." },
        { status: 400 }
      );
    }

    // keep two-decimal precision
    const incrementBy = Math.round(packs * packingSize * 100) / 100;

    await db.product.update({
      where: { id },
      data: {
        stock: { decrement: packs },
        packingStock: { increment: incrementBy },
      },
    });

    return json({
      success: true,
      action: "open-pack",
      id,
      packs,
      added: incrementBy,
    });
  }

  if (
    actionType === "delete-location" ||
    actionType === "delete-brand" ||
    actionType === "delete-indication" ||
    actionType === "delete-target"
  ) {
    return json(
      {
        success: false,
        error:
          "Master-data delete is disabled in Product List. Use Admin > Master Data routes.",
      },
      { status: 403 }
    );
  }

  if (toggleId && newIsActive !== null) {
    await db.product.update({
      where: { id: Number(toggleId) },
      data: { isActive: newIsActive === "true" },
    });

    return json({ success: true, action: "toggled" });
  }
  return runProductUpsertAction({
    formData,
    existingProduct,
    processedPhotoUploads,
    persistProductPhotos,
  });
};

// ---------------------- Components ----------------------------------

export default function ProductsPage() {
  const {
    products: initialProducts,
    categories,
    brands: initialBrands,
    indications,
    targets,
    locations,
  } = useLoaderData<LoaderData>();

  // top of the file, module scope (outside the component)

  const revalidator = useRevalidator();

  // — State & Options —
  const [products, setProducts] =
    useState<ProductWithDetails[]>(initialProducts);
  const brands = initialBrands;

  // -fetcher for reloading after create/update/delete-
  const actionFetcher = useFetcher<ProductActionResult>();

  const [showAlert, setShowAlert] = useState(false);
  // — Filters & Paging —
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterTarget, setFilterTarget] = useState("");
  const [filterIndications, setFilterIndications] = useState<string[]>([]);
  const [filterLocation, setFilterLocation] = useState("");

  const itemsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const filteredIndications = useMemo(
    () =>
      indications.filter(
        (ind) => !filterCategory || ind.categoryId === Number(filterCategory)
      ),
    [indications, filterCategory]
  );

  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");

  // — Messages —
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // ---  ui / ux  ----
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const prevPageRef = useRef(currentPage);

  //-------Effects ----------------------------------------------------------

  const locationOptions = useMemo(
    () => locations.map((l) => ({ label: l.name, value: String(l.id) })),
    [locations]
  );

  // Filtered for the top-of-page Brand FILTER (uses filterCategory)
  const brandOptionsForFilter = useMemo(() => {
    const list = filterCategory
      ? brands.filter((b) => String(b.categoryId ?? "") === filterCategory)
      : brands;
    return list.map((b) => ({ label: b.name, value: String(b.id) }));
  }, [brands, filterCategory]);

  // Unified product list updater

  // 🔁 Track previous filters
  const prevFiltersRef = useRef({
    filterCategory: "",
    filterBrand: "",
    filterTarget: "",
    filterIndications: [] as string[],
    filterLocation: "",
    filterStatus: "all" as StatusFilter,
  });

  const validIndicationNames = useMemo(() => {
    const filteredByTopFilters = products.filter((p) => {
      const okCat =
        !filterCategory || String(p.categoryId ?? "") === filterCategory;
      const okBr = !filterBrand || String(p.brandId ?? "") === filterBrand;
      const okLoc =
        !filterLocation ||
        String(p.location?.id ?? p.locationId ?? "") === filterLocation;
      return okCat && okBr && okLoc;
    });

    const names = new Set<string>();
    for (const p of filteredByTopFilters) {
      for (const ind of p.indications ?? []) {
        names.add(ind.name);
      }
    }
    return names;
  }, [products, filterCategory, filterBrand, filterLocation]);

  useEffect(() => {
    // Keep selected indication filters only if they still exist for current top filters.
    setFilterIndications((prev) => {
      const next = prev.filter((name) => validIndicationNames.has(name));
      const unchanged =
        next.length === prev.length &&
        next.every((name, idx) => name === prev[idx]);
      return unchanged ? prev : next;
    });
  }, [validIndicationNames]);

  const targetOptions = useMemo(() => {
    const filtered = targets.filter((t) => {
      const okCat =
        !filterCategory || String(t.categoryId ?? "") === filterCategory;
      const okBr = !filterBrand || String(t.brandId ?? "") === filterBrand;
      return okCat && okBr;
    });

    const byId = new Map<string, { label: string; value: string }>();
    for (const t of filtered) {
      const idKey = String(t.id);
      if (!byId.has(idKey)) {
        byId.set(idKey, { label: t.name, value: idKey });
      }
    }

    return Array.from(byId.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }, [targets, filterCategory, filterBrand]);

  useEffect(() => {
    if (filterTarget && !targetOptions.some((o) => o.value === filterTarget)) {
      setFilterTarget("");
    }
  }, [filterTarget, targetOptions]);

  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.filterCategory !== filterCategory ||
      prev.filterBrand !== filterBrand ||
      prev.filterLocation !== filterLocation ||
      prev.filterTarget !== filterTarget ||
      prev.filterStatus !== filterStatus ||
      JSON.stringify(prev.filterIndications) !==
        JSON.stringify(filterIndications);

    if (changed) {
      setCurrentPage(1);
      prevFiltersRef.current = {
        filterCategory,
        filterBrand,
        filterLocation,
        filterTarget,
        filterIndications,
        filterStatus,
      };
    }
  }, [
    filterCategory,
    filterBrand,
    filterLocation,
    filterTarget,
    filterIndications,
    filterStatus,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sortBy]);

  // Scroll to table only when page number actually changes.
  // This avoids initial-route auto-scroll even under React StrictMode.
  useEffect(() => {
    if (prevPageRef.current === currentPage) {
      return;
    }
    prevPageRef.current = currentPage;
    const timeout = setTimeout(() => {
      const anchor = document.getElementById("table-anchor");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth" });
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [currentPage]);

  // Handle create/update/delete feedback:

  // Hoist stable snapshots so we don't depend on the whole fetcher
  const afData = actionFetcher.data;
  const submittedForm = extractSubmittedForm(actionFetcher);

  // Prevent duplicate handling (StrictMode / re-renders)
  const lastHandledRef = useRef<string>("");
  const lastDeleteDataRef = useRef<ProductActionResult | null>(null);

  useEffect(() => {
    if (!afData) return;

    const action = afData.action ?? String(submittedForm?.get("_action") ?? "");
    const submittedId = String(
      afData.id ??
        submittedForm?.get("id") ??
        submittedForm?.get("deleteId") ??
        ""
    );

    // Build a small signature for this result and skip if we've already handled it
    const signature = `${action}|${submittedId}|${
      afData.success ? "ok" : afData.error ? "err" : ""
    }`;
    if (lastHandledRef.current === signature) return;
    lastHandledRef.current = signature;

    // Skip all delete actions here — handled in the dedicated delete-effect
    if (action === "delete-product" || action === "deleted") {
      return;
    }

    if (action === "open-pack") {
      const openedId = Number(submittedId);
      const packs = Math.max(
        1,
        Math.floor(Number(submittedForm?.get("packs") || "1"))
      );

      if (Number.isFinite(openedId) && openedId > 0 && packs > 0) {
        revalidator.revalidate();
      }

      setSuccessMsg(`Unpacked ${packs} → retail stock`);
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 1500);

      // optional safety refresh:
      // setTimeout(() => revalidator.revalidate(), 200);
      return;
    }

    if (afData.success) {
      const msgMap: Record<string, string> = {
        created: "✅ Product successfully saved.",
        updated: "✏️ Product successfully updated.",
        deleted: "🗑️ Product deleted successfully.",
        "delete-product": "🗑️ Product deleted successfully.",
        toggled: "Product status updated!",
        "open-pack": "↘︎ Opened stock to retail.",
      };

      setSuccessMsg(msgMap[action] || "✅ Operation completed.");

      setErrorMsg("");

      // Optimistic delete (and STOP — no revalidate here to avoid flicker)
      if (action === "delete-product" || action === "deleted") {
        if (submittedId) {
          setProducts((prev) =>
            prev.filter((p) => String(p.id) !== submittedId)
          );
        }
        // Optionally revalidate after a short delay if you want extra safety:
        // setTimeout(() => revalidator.revalidate(), 200);
        return;
      }
      if (
        action === "created" ||
        action === "updated" ||
        action === "toggled"
      ) {
        if (!submittedForm) {
          revalidator.revalidate();
          // highlight if server gave us an id
          if (afData.id) {
            setHighlightId(Number(afData.id));
            setTimeout(() => setHighlightId(null), 3000);
          }
          return;
        }
        const f = submittedForm!;
        // prefer server id if provided

        const asNumber = (v: FormDataEntryValue | null) => {
          if (v == null) return undefined;
          const s = String(v).trim();
          if (s === "") return undefined;
          const n = Number(s);
          return Number.isFinite(n) ? n : undefined;
        };

        const asBoolIfPresent = (name: string): boolean | undefined => {
          if (!f.has(name)) return undefined;
          return String(f.get(name)) === "true";
        };

        const asStringIfPresent = (name: string): string | undefined => {
          if (!f.has(name)) return undefined;
          return String(f.get(name) ?? "");
        };

        const patchedId =
          Number(afData.id ?? f.get("id") ?? f.get("deleteId") ?? 0) || 0;

        // build a safe, partial patch from the submitted form
        const patch = {
          id: patchedId,
          // text fields guarded so we don't blank them on actions that didn't submit them
          name: asStringIfPresent("name"),
          barcode: asStringIfPresent("barcode"),
          sku: asStringIfPresent("sku"),
          description: asStringIfPresent("description"),

          // numbers (undefined if missing/blank)
          price: asNumber(f.get("price")),
          srp: asNumber(f.get("srp")),
          dealerPrice: asNumber(f.get("dealerPrice")),
          stock: asNumber(f.get("stock")),
          packingStock: asNumber(f.get("packingStock")),
          packingSize: asNumber(f.get("packingSize")),
          minStock: asNumber(f.get("minStock")),

          // booleans only if present
          allowPackSale: asBoolIfPresent("allowPackSale"),
          isActive: asBoolIfPresent("isActive"),
        } as Partial<ProductWithDetails> & { id: number };

        if (Object.prototype.hasOwnProperty.call(afData, "imageUrl")) {
          patch.imageUrl = afData.imageUrl ?? null;
        }

        setProducts((prev) => {
          if (!patch.id) return prev;
          const idx = prev.findIndex((p) => p.id === patch.id);
          if (idx === -1) {
            return prev;
            // created: insert at top (recent first)
          }

          const next = prev.slice();
          next[idx] = { ...prev[idx], ...patch };
          return next;
        });
      }
      // For create/update/toggle, pull fresh list
      if (
        action === "created" ||
        action === "updated" ||
        action === "toggled"
      ) {
        revalidator.revalidate();
      }

      // Highlight if server returned a product id
      if (afData.id) setHighlightId(Number(afData.id));
      setTimeout(() => setHighlightId(null), 3000);

      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    // Error branch
    if (afData.error) {
      const errorText = afData.field ? afData.error ?? "" : afData.error;
      setErrorMsg(errorText);
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2500);
      setSuccessMsg("");
    }
  }, [afData, submittedForm, revalidator]);

  // Handle delete-product feedback

  useEffect(() => {
    const data = actionFetcher.data;
    if (!data || !data.success) return;
    if (lastDeleteDataRef.current === data) return;
    lastDeleteDataRef.current = data;

    const form = extractSubmittedForm(actionFetcher);
    const action = data.action ?? String(form?.get("_action") ?? "");

    if (action !== "delete-product" && action !== "deleted") return;

    const dedupeKey = `del:product|${String(form?.get("id") ?? data.id ?? "")}`;
    if (lastHandledRef.current === dedupeKey) return;
    lastHandledRef.current = dedupeKey;

    const deletedId = String(form?.get("id") ?? data.id ?? "");
    if (deletedId) {
      setProducts((prev) => prev.filter((p) => String(p.id) !== deletedId));
    }
    setSuccessMsg("🗑️ Product deleted successfully.");
  }, [
    actionFetcher.data,
    actionFetcher,
    lastHandledRef,
  ]);

  // keep local table in sync whenever the loader revalidates
  useEffect(() => {
    setProducts(
      [...initialProducts].sort(
        (a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt)
      )
    );
  }, [initialProducts]);
  // Unified toast controller: show when message exists, auto-hide + clear
  useEffect(() => {
    // nothing to show -> ensure hidden
    if (!successMsg && !errorMsg) {
      setShowAlert(false);
      return;
    }
    // show toast immediately
    setShowAlert(true);
    // auto-close + clear after 1.5s
    const timer = setTimeout(() => {
      setShowAlert(false);
      setSuccessMsg("");
      setErrorMsg("");
    }, 1500);
    return () => clearTimeout(timer);
  }, [successMsg, errorMsg]);

  const priceForSort = (p: ProductWithDetails) => {
    const srp = Number(p.srp ?? 0);
    const retail = Number(p.price ?? 0);
    return srp > 0 ? srp : retail > 0 ? retail : Number.POSITIVE_INFINITY;
  };

  const totalRetailAvailability = (p: ProductWithDetails) => {
    const stock = Number(p.stock ?? 0);
    const packSize = Number(p.packingSize ?? 0);
    const retailStock = Number(p.packingStock ?? 0);
    if (p.allowPackSale && packSize > 0) {
      return stock * packSize + retailStock;
    }
    return stock; // fallback
  };

  const filteredProducts = useMemo(() => {
    const s = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const okSearch =
        !s ||
        p.name.toLowerCase().includes(s) ||
        (p.description ?? "").toLowerCase().includes(s) ||
        p.brand?.name.toLowerCase().includes(s);

      const okCat =
        !filterCategory || String(p.categoryId ?? "") === filterCategory;

      const okBr = !filterBrand || String(p.brandId ?? "") === filterBrand;

      const productLocId = p.location?.id ?? p.locationId;
      const okLoc =
        !filterLocation || String(productLocId ?? "") === filterLocation;

      const okTg =
        !filterTarget ||
        (p.targets ?? []).some(
          (t) => String(t.id) === filterTarget || t.name === filterTarget // fallback
        );

      const okUse =
        filterIndications.length === 0 ||
        filterIndications.every((u) =>
          (p.indications ?? []).some((i) => i.name === u)
        );

      const okStatus =
        filterStatus === "all" ||
        (filterStatus === "active" && p.isActive) ||
        (filterStatus === "inactive" && !p.isActive);

      return okSearch && okCat && okBr && okLoc && okTg && okUse && okStatus;
    });
  }, [
    products,
    searchTerm,
    filterCategory,
    filterBrand,
    filterLocation,
    filterTarget,
    filterIndications,
    filterStatus,
  ]);

  const sortedProducts = useMemo(() => {
    const arr = [...filteredProducts];
    switch (sortBy) {
      case "price-asc":
        arr.sort((a, b) => priceForSort(a) - priceForSort(b));
        break;
      case "price-desc":
        arr.sort((a, b) => priceForSort(b) - priceForSort(a));
        break;
      case "name-asc":
        arr.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
        break;
      case "stock-asc": // lowest stock first
        arr.sort((a, b) => {
          const av = totalRetailAvailability(a) - totalRetailAvailability(b);
          if (av !== 0) return av;
          return a.name.localeCompare(b.name);
        });
        break;
      case "recent":
      default:
        arr.sort(
          (a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt)
        );
        break;
    }
    return arr;
  }, [filteredProducts, sortBy]);

  const paginatedProducts = useMemo(
    () =>
      sortedProducts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
      ),
    [sortedProducts, currentPage]
  );
  const targetFilterSummary = filterTarget
    ? targetOptions.find((option) => option.value === filterTarget)?.label ??
      "1 selected"
    : "All targets";
  const indicationFilterSummary =
    filterIndications.length > 0
      ? `${filterIndications.length} selected`
      : "All indications";

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="Product List"
        subtitle="Catalog directory with compact filters and product actions."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto w-full max-w-6xl space-y-5 px-5 py-6">
        <SoTActionBar
          left={
            <p className="text-xs text-slate-500">
              Showing {paginatedProducts.length} · {sortedProducts.length} matching
            </p>
          }
          right={
            <SoTLinkButton
              to="/products/new"
              variant="primary"
              className="group gap-2 sm:px-4"
              aria-label="Add Product"
            >
              <svg
                className="h-5 w-5 -ml-0.5 sm:ml-0 transition-transform group-hover:scale-110"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 5v14M5 12h14"
                />
              </svg>
              <span>Add Product</span>
            </SoTLinkButton>
          }
        />

        <SoTCard className="space-y-4 sm:p-5">
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
              <div className="space-y-1 lg:col-span-8">
                <label
                  htmlFor="product-search"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  Search catalog
                </label>
                <SoTSearchInput
                  id="product-search"
                  type="text"
                  placeholder="Search name, description, or brand"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="lg:col-span-4">
                <SelectInput
                  label="Sort"
                  name="sortBy"
                  value={sortBy}
                  onChange={(v) => setSortBy(v as SortBy)}
                  options={[
                    { label: "Recent", value: "recent" },
                    { label: "A → Z", value: "name-asc" },
                    { label: "Price: Low → High", value: "price-asc" },
                    { label: "Price: High → Low", value: "price-desc" },
                    { label: "Stock: Lowest First", value: "stock-asc" },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12">
              <div className="xl:col-span-3">
                <SelectInput
                  label="Category"
                  name="category"
                  value={filterCategory}
                  onChange={(val) => {
                    setFilterCategory(String(val));
                    setFilterBrand("");
                  }}
                  options={[
                    {
                      label: "All Categories",
                      value: "",
                      style: { color: "#888" },
                    },
                    ...categories.map((c) => ({ label: c.name, value: c.id })),
                  ]}
                />
              </div>

              <div className="xl:col-span-3">
                <SelectInput
                  name="brandId"
                  label="Brand"
                  value={filterBrand}
                  onChange={(val) => setFilterBrand(String(val))}
                  options={[
                    { label: "All Brands", value: "", style: { color: "#888" } },
                    ...brandOptionsForFilter,
                  ]}
                />
              </div>

              <div className="xl:col-span-3">
                <SelectInput
                  name="locationFilter"
                  label="Location"
                  value={filterLocation}
                  onChange={(val) => setFilterLocation(String(val))}
                  options={[
                    { label: "All Locations", value: "", style: { color: "#888" } },
                    ...locationOptions,
                  ]}
                />
              </div>

              <fieldset className="space-y-1 xl:col-span-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Status
                </legend>
                <div className="grid h-9 grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                  {[
                    { label: "All", value: "all" as const },
                    { label: "Active", value: "active" as const },
                    { label: "Inactive", value: "inactive" as const },
                  ].map((opt) => {
                    const selected = filterStatus === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={clsx(
                          "inline-flex h-full cursor-pointer items-center justify-center rounded-lg px-2 text-xs font-semibold transition-colors duration-150",
                          "focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-200 focus-within:ring-offset-1",
                          selected
                            ? opt.value === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : opt.value === "inactive"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-indigo-100 text-indigo-800"
                            : "text-slate-600 hover:bg-white"
                        )}
                      >
                        <input
                          type="radio"
                          name="status"
                          value={opt.value}
                          className="sr-only"
                          checked={selected}
                          onChange={() => setFilterStatus(opt.value)}
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </section>

          <div className="h-px bg-slate-200" />

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <details className="group rounded-xl border border-slate-200 bg-white">
              <summary className="flex h-10 list-none cursor-pointer items-center justify-between px-3 text-sm font-medium text-slate-700">
                <span>Target</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-normal text-slate-500">
                    {targetFilterSummary}
                  </span>
                  <span className="text-slate-500 transition-transform duration-150 group-open:rotate-180">
                    ▼
                  </span>
                </div>
              </summary>
              <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  {[{ label: "All", value: "" }, ...targetOptions].map((option) => (
                    <label
                      key={option.value}
                      className={clsx(
                        "inline-flex h-8 cursor-pointer items-center rounded-xl border px-3 text-xs font-medium transition-colors duration-150",
                        "focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-200 focus-within:ring-offset-1",
                        filterTarget === option.value
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      <input
                        type="radio"
                        name="target"
                        value={option.value}
                        className="sr-only"
                        checked={filterTarget === option.value}
                        onChange={() => setFilterTarget(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-white">
              <summary className="flex h-10 list-none cursor-pointer items-center justify-between px-3 text-sm font-medium text-slate-700">
                <span>Indications</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-normal text-slate-500">
                    {indicationFilterSummary}
                  </span>
                  <span className="text-slate-500 transition-transform duration-150 group-open:rotate-180">
                    ▼
                  </span>
                </div>
              </summary>
              <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                <div className="max-h-[300px] overflow-y-auto overscroll-contain pr-1">
                  <div className="flex flex-wrap gap-2">
                    {filteredIndications.map((ind) => (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() => {
                          if (filterIndications.includes(ind.name)) {
                            setFilterIndications(
                              filterIndications.filter((name) => name !== ind.name)
                            );
                            return;
                          }
                          setFilterIndications([...filterIndications, ind.name]);
                        }}
                        className={clsx(
                          "inline-flex h-8 items-center rounded-xl border px-3 text-xs font-medium transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1",
                          filterIndications.includes(ind.name)
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        )}
                        aria-pressed={filterIndications.includes(ind.name)}
                      >
                        {ind.name}
                      </button>
                    ))}
                  </div>
                  {filteredIndications.length === 0 ? (
                    <p className="text-xs text-slate-500">No indications available.</p>
                  ) : null}
                </div>
              </div>
            </details>
          </section>

          <div className="h-px bg-slate-200" />

          {/* 📦 Product Table */}
          <div className="space-y-3">
            {!paginatedProducts.length ? (
              <SoTEmptyState
                title="No products available."
                hint="Clear filters or add a product."
                className="mt-1"
              />
            ) : (
              <ProductsListTable
                products={paginatedProducts}
                highlightId={highlightId}
                actionFetcher={actionFetcher}
              />
            )}

            <div className="pt-1 sm:pt-2">
              <Pagination
                currentPage={currentPage}
                totalItems={sortedProducts.length}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPage}
              />
            </div>
          </div>
        </SoTCard>
      </div>

      <Toast
        message={successMsg || errorMsg}
        type={successMsg ? "success" : "error"}
        visible={showAlert}
        onClose={() => {
          setShowAlert(false);
          setSuccessMsg("");
          setErrorMsg("");
        }}
      />
    </main>
  );
}
