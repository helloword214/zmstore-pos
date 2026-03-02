/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { storage } from "~/utils/storage.server";
import {
  Link,
  useLoaderData,
  useFetcher,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useRef, useState, useMemo } from "react";
import type { LoaderData, ProductWithDetails } from "~/types";
import { db } from "~/utils/db.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { TagCheckbox } from "~/components/ui/TagCheckbox";
import { ProductTable } from "~/components/ui/ProductTable";
import { Pagination } from "~/components/ui/Pagination";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { generateSKU } from "~/utils/skuHelpers";
import { clsx } from "clsx";
import { Toast } from "~/components/ui/Toast";

// === END Imports ===

type SortBy = "recent" | "name-asc" | "price-asc" | "price-desc" | "stock-asc";

type StatusFilter = "all" | "active" | "inactive";

export async function loader() {
  const [
    products,
    categories,
    brands,
    units,
    packingUnits,
    indications, // ✅ include this // //
    ,
    // / ← skip db.target.findMany() result (keep position)
    locations, // ✅ now this matches db.location.findMany()
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
    db.target.findMany({
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    db.location.findMany({
      orderBy: { name: "asc" },
    }), // ✅ fetch locations
  ]);

  // Flatten the join tables into simple name arrays
  const productsWithDetails = products.map((p) => ({
    ...p,

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
  }));

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
    units, // ✅ retail units (e.g. kg, capsule)
    packingUnits, // ✅ containers (e.g. sack, bottle)
    indications,
    targets: targetsForFilter,
    locations,
    storeCode: process.env.STORE_CODE ?? "00",
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const toggleId = formData.get("toggleId");
  const newIsActive = formData.get("isActive");

  // Common fields
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim() || "";
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const parseMoneyNumber = (value: FormDataEntryValue | null, fallback = 0) => {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    const cleaned = raw.replace(/[^0-9.-]/g, "");
    if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "-.") {
      return fallback;
    }
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const priceRaw = parseMoneyNumber(formData.get("price"), 0);
  const price = r2(priceRaw);
  const unitId = formData.get("unitId")
    ? parseInt(formData.get("unitId")!.toString())
    : undefined;

  const packingUnitId = formData.get("packingUnitId")
    ? parseInt(formData.get("packingUnitId")!.toString())
    : undefined;

  const categoryId = formData.get("categoryId")
    ? Number(formData.get("categoryId"))
    : undefined;

  const category = categoryId
    ? await db.category.findUnique({ where: { id: categoryId } })
    : null;

  const categoryNameFromDb = category?.name || "";

  const brandIdRaw = formData.get("brandId")?.toString();
  const brandName = formData.get("brandName")?.toString().trim() || "";
  const stock = r2(parseMoneyNumber(formData.get("stock"), 0));
  const packingStockRaw = formData.get("packingStock")?.toString() || "0";
  const packingStock = r2(parseMoneyNumber(formData.get("packingStock"), 0));
  const dealerPriceRaw = parseMoneyNumber(formData.get("dealerPrice"), 0);
  const dealerPrice = r2(dealerPriceRaw);

  const srpRaw = parseMoneyNumber(formData.get("srp"), 0);
  const srp = r2(srpRaw);
  const packingSizeRaw = parseMoneyNumber(formData.get("packingSize"), 0);
  const packingSize = r2(packingSizeRaw);
  const expiration = formData.get("expirationDate")?.toString();
  const replenishAt = formData.get("replenishAt")?.toString();
  const imageTag = formData.get("imageTag")?.toString().trim();
  const imageUrlInput = formData.get("imageUrl")?.toString().trim();
  const imageFile = formData.get("imageFile") as File | null;
  const description = formData.get("description")?.toString();
  const barcode = formData.get("barcode")?.toString() || undefined;
  const minStock = formData.get("minStock")
    ? parseMoneyNumber(formData.get("minStock"), 0)
    : undefined;
  const locRaw = (formData.get("locationId") ?? "").toString().trim();
  const customLocationName = (formData.get("customLocationName") ?? "")
    .toString()
    .trim();
  const isActive = formData.get("isActive")?.toString() !== "false"; // default true
  const allowPackSale = formData.get("allowPackSale") === "true";

  // if updating, load existing imageUrl so we can clean up on replace
  const existingProduct = id
    ? await db.product.findUnique({
        where: { id: Number(id) },
        select: { imageUrl: true, imageKey: true },
      })
    : null;

  let finalImageUrl: string | undefined = imageUrlInput || undefined;
  let finalImageKey: string | undefined;

  //for image size checking helper
  const parseMb = (v: string | undefined, fallback: number) => {
    const n = Number.parseFloat(v ?? "");
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const sku = formData.get("sku")?.toString().trim() || "";
  const finalSku =
    sku ||
    generateSKU({ category: categoryNameFromDb, brand: brandName, name });

  // ** NEW **: parse multi-value fields
  const indicationIdsRaw = (formData.getAll("indicationIds") as string[])
    .map(Number)
    .filter((n) => !isNaN(n));

  const targetIdsRaw = (formData.getAll("targetIds") as string[])
    .map(Number)
    .filter((n) => !isNaN(n));

  const newIndications = formData.getAll("newIndications") as string[];
  const newTargets = formData.getAll("newTargets") as string[];

  const decimals = (packingStockRaw.split(".")[1] || "").length;

  //deletaion LOGIC
  const actionType = formData.get("_action")?.toString();

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

  if (imageFile && imageFile.size > 0) {
    // accept any image/* and process on server

    const { default: sharp } = await import("sharp"); // server-only import

    if (!String(imageFile.type || "").startsWith("image/")) {
      return json(
        { success: false, error: "File must be an image." },
        { status: 400 }
      );
    }

    const MAX_MB = parseMb(process.env.MAX_UPLOAD_MB, 20);
    const maxBytes = Math.max(1, Math.floor(MAX_MB * 1024 * 1024));

    const fileSize = Number(imageFile.size) || 0;
    console.log(
      "[upload] name=%s type=%s size=%dB limit=%dB (%dMB)",
      (imageFile as any).name,
      imageFile.type,
      fileSize,
      maxBytes,
      MAX_MB
    );

    if (fileSize > maxBytes) {
      return json(
        {
          success: false,
          error: `Image too large (>${MAX_MB}MB). Received ${fileSize} bytes.`,
        },
        { status: 400 }
      );
    }
    try {
      const input = Buffer.from(await imageFile.arrayBuffer());
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
        keyPrefix: "products",
      });
      finalImageUrl = saved.url;
      finalImageKey = saved.key;
      console.log(
        `[upload] saved ${saved.key} (${saved.size}B) → ${saved.url}`
      );
    } catch (e) {
      console.error("[image] processing failed:", e);
      return json(
        { success: false, error: "Failed to process image." },
        { status: 400 }
      );
    }
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
    if (!prod.packingSize || prod.packingSize <= 0) {
      return json(
        { success: false, error: "Packing size is not set." },
        { status: 400 }
      );
    }
    if (prod.stock == null || prod.stock < packs) {
      return json(
        { success: false, error: "Not enough whole stock to open." },
        { status: 400 }
      );
    }

    // keep two-decimal precision
    const incrementBy = Math.round(packs * prod.packingSize * 100) / 100;

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
  // 🔐 Required field validation
  if (!name) {
    return json(
      { success: false, error: "Product name is required." },
      { status: 400 }
    );
  }

  if (!categoryId) {
    return json(
      { success: false, error: "Category must be selected." },
      { status: 400 }
    );
  }

  if (allowPackSale && (!price || price <= 0)) {
    return json(
      {
        success: false,
        error: "Retail price is required if retail sale is allowed.",
        field: "price",
      },
      { status: 400 }
    );
  }

  if (!unitId) {
    return json(
      { success: false, error: "Retail unit is required." },
      { status: 400 }
    );
  }

  if (!packingSize || packingSize <= 0) {
    return json(
      {
        success: false,
        error: "Packing Size is required.",
        field: "packingSize",
      },
      { status: 400 }
    );
  }

  if (!dealerPrice || dealerPrice <= 0) {
    return json(
      {
        success: false,
        error: "Cost Price is required.",
        field: "dealerPrice",
      },
      { status: 400 }
    );
  }

  if (!packingUnitId) {
    return json(
      {
        success: false,
        error: "Packing Unit is required.",
        field: "packingUnitId",
      },
      { status: 400 }
    );
  }

  if (!srp || srp <= 0) {
    return json(
      { success: false, error: "Whole Unit Price is required.", field: "srp" },
      { status: 400 }
    );
  }

  //stock lessthan 0 validation
  if (
    price < 0 ||
    stock < 0 ||
    packingStock < 0 ||
    dealerPrice < 0 ||
    srp < 0 ||
    (minStock !== undefined && minStock < 0)
  ) {
    return json(
      {
        success: false,
        error:
          "Please enter valid non-negative numbers for price, stock, and packing.",
      },
      { status: 400 }
    );
  }

  // 🔴 Keep decimal precision validation

  if (decimals > 2) {
    return json(
      {
        success: false,
        error: "Packing stock cannot have more than 2 decimal places.",
        field: "packingStock",
      },
      { status: 400 }
    );
  }

  // packing validation
  // ✅ Validate retail unit (e.g., kg, capsule)
  if (unitId) {
    const valid = await db.unit.findUnique({ where: { id: unitId } });
    if (!valid) {
      return json(
        { success: false, error: "Invalid retail unit selected." },
        { status: 400 }
      );
    }
  }

  // ✅ Validate packing unit (e.g., sack, bottle)
  if (packingUnitId) {
    const valid = await db.packingUnit.findUnique({
      where: { id: packingUnitId },
    });
    if (!valid) {
      return json(
        { success: false, error: "Invalid packing unit selected." },
        { status: 400 }
      );
    }
  }

  // Resolve or create brand
  let resolvedBrandId = brandIdRaw ? Number(brandIdRaw) : undefined;
  if (!resolvedBrandId && brandName) {
    if (!categoryId) {
      return json(
        {
          success: false,
          error: "Please pick a category first.",
          field: "categoryId",
        },
        { status: 400 }
      );
    }
    const existing = await db.brand.findFirst({
      where: { name: { equals: brandName, mode: "insensitive" }, categoryId },
    });
    if (existing) {
      return json(
        { success: false, error: `Brand already exists.`, field: "brandName" },
        { status: 400 }
      );
    }
    const nb = await db.brand.create({
      data: {
        name: brandName.trim(),
        category: { connect: { id: categoryId } },
      },
    });
    resolvedBrandId = nb.id;
  }
  let resolvedLocationId: number | null = null;
  const isNumericId = /^\d+$/.test(locRaw);
  if (customLocationName && (locRaw === "__custom__" || !isNumericId)) {
    // create-or-get by name (case-insensitive)
    const existing = await db.location.findFirst({
      where: { name: { equals: customLocationName, mode: "insensitive" } },
    });
    const loc =
      existing ??
      (await db.location.create({ data: { name: customLocationName } }));
    resolvedLocationId = loc.id;
  } else if (isNumericId) {
    resolvedLocationId = Number(locRaw);
  } else {
    resolvedLocationId = null;
  }

  const createdIndicationIds: number[] = [];
  for (const name of newIndications.map((s) => s.trim()).filter(Boolean)) {
    const existing = await db.indication.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, categoryId },
    });
    if (!existing) {
      const ind = await db.indication.create({
        data: { name, category: { connect: { id: categoryId! } } },
      });
      createdIndicationIds.push(ind.id);
    } else {
      createdIndicationIds.push(existing.id);
    }
  }

  const createdTargetIds: number[] = [];
  for (const name of newTargets.map((s) => s.trim()).filter(Boolean)) {
    const existing = await db.target.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, categoryId },
    });
    if (!existing) {
      const tgt = await db.target.create({
        data: { name, category: { connect: { id: categoryId! } } },
      });
      createdTargetIds.push(tgt.id);
    } else {
      createdTargetIds.push(existing.id);
    }
  }

  const indicationIds = Array.from(
    new Set([...indicationIdsRaw, ...createdIndicationIds])
  );
  const targetIds = Array.from(new Set([...targetIdsRaw, ...createdTargetIds]));

  // Build the shared data object
  const commonData = {
    name,
    price,
    sku: finalSku,
    barcode,
    stock,
    dealerPrice,
    srp,
    packingSize,
    packingStock,
    expirationDate: expiration ? new Date(expiration) : undefined,
    replenishAt: replenishAt ? new Date(replenishAt) : undefined,
    imageTag,
    imageUrl: finalImageUrl,
    imageKey: finalImageKey,
    description,
    minStock,
    isActive,
    allowPackSale,
    location:
      resolvedLocationId != null
        ? { connect: { id: resolvedLocationId } }
        : undefined,
    unit: unitId ? { connect: { id: unitId } } : undefined,
    category: categoryId ? { connect: { id: categoryId } } : undefined,
    packingUnit: packingUnitId ? { connect: { id: packingUnitId } } : undefined,
    brand: resolvedBrandId ? { connect: { id: resolvedBrandId } } : undefined,
  };

  try {
    if (id) {
      // ─ UPDATE ─ clear old joins, then recreate from the IDs

      const indIds = [
        ...new Set(
          [...(indicationIds ?? []), ...(createdIndicationIds ?? [])].map(
            Number
          )
        ),
      ];
      const tgtIds = [
        ...new Set(
          [...(targetIds ?? []), ...(createdTargetIds ?? [])].map(Number)
        ),
      ];

      await db.product.update({
        where: { id: Number(id) },
        data: {
          ...commonData,
          productIndications: {
            deleteMany: {}, // scoped to this product
            create: indIds.map((indId) => ({
              indication: { connect: { id: indId } },
            })),
          },
          productTargets: {
            deleteMany: {},
            create: tgtIds.map((tId) => ({ target: { connect: { id: tId } } })),
          },
        },
      });

      // 🧹 If image was replaced, delete old local file (post-update for safety)
      if (
        finalImageUrl &&
        existingProduct?.imageUrl &&
        existingProduct.imageUrl !== finalImageUrl
      ) {
        const oldKey =
          existingProduct.imageKey ??
          (existingProduct.imageUrl.startsWith("/uploads/")
            ? existingProduct.imageUrl.slice("/uploads/".length)
            : undefined);
        if (oldKey) {
          try {
            await storage.delete(oldKey);
          } catch (e) {
            console.warn("delete old image failed", e);
          }
        }
      }
      return json({
        success: true,
        action: "updated",
        id: Number(id),
        imageUrl: finalImageUrl,
      });
    } else {
      // ─ CREATE ─ just create with connections, no deleteMany

      const createdProduct = await db.product.create({
        data: {
          ...commonData,
          productIndications: {
            create: [...indicationIds, ...createdIndicationIds].map(
              (indId) => ({
                indication: { connect: { id: indId } },
              })
            ),
          },
          productTargets: {
            create: [...targetIds, ...createdTargetIds].map((tId) => ({
              target: { connect: { id: tId } },
            })),
          },
        },
      });

      return json({
        success: true,
        action: "created",
        id: createdProduct.id,
        imageUrl: finalImageUrl,
      });
    }
  } catch (err: any) {
    console.error("[❌ Product action error]:", err);
    return json(
      { success: false, error: err.message || "Saving failed" },
      { status: 500 }
    );
  }
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
  const actionFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    field?: string;
    action?: "created" | "updated" | "deleted" | "toggled";
    id?: number; //
  }>();

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
    const filtered = targets.filter((t: any) => {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afSubmission = (actionFetcher as any)?.submission as
    | { formData?: FormData }
    | undefined;

  // Remix sometimes exposes formData directly instead of submission
  const submittedForm: FormData | undefined =
    afSubmission?.formData ?? (actionFetcher as any)?.formData;

  // Prevent duplicate handling (StrictMode / re-renders)
  const lastHandledRef = useRef<string>("");
  const lastDeleteDataRef = useRef<any>(null);

  useEffect(() => {
    if (!afData) return;

    const action =
      (afData.action as string) ?? String(submittedForm?.get("_action") ?? "");
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

      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== openedId) return p;
          const packSize = Number(p.packingSize ?? 0);
          const add = Math.round(packs * packSize * 100) / 100;
          return {
            ...p,
            stock: Math.max(0, (p.stock ?? 0) - packs),
            packingStock: Number(((p.packingStock ?? 0) + add).toFixed(2)),
          };
        })
      );

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

      if ((afData as any)?.imageUrl) {
        console.log("✅ Image uploaded →", (afData as any).imageUrl);
      }

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

          //image
          imageUrl: (afData as any)?.imageUrl ?? asStringIfPresent("imageUrl"),
        } as Partial<ProductWithDetails> & { id: number };

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
      const { field, error } = afData as any;
      if (field) {
        setErrorMsg(error);
        setShowAlert(true);
        setTimeout(() => setShowAlert(false), 2500);
      } else {
        setErrorMsg(afData.error);
        setShowAlert(true);
        setTimeout(() => setShowAlert(false), 2500);
      }
      setSuccessMsg("");
    }
  }, [afData, submittedForm, revalidator]);

  // Handle delete-product feedback

  useEffect(() => {
    const data = actionFetcher.data;
    if (!data || !data.success) return;
    if (lastDeleteDataRef.current === data) return;
    lastDeleteDataRef.current = data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const submission = (actionFetcher as any)?.submission;
    const form: FormData | undefined =
      submission?.formData ?? (actionFetcher as any)?.formData;
    const action =
      (data.action as string) ?? String(form?.get("_action") ?? "");

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
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
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
          (a, b) =>
            new Date(b.createdAt as any).getTime() -
            new Date(a.createdAt as any).getTime()
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

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="Product List"
        subtitle="Catalog list, operational filters, and deep-link product actions."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto w-full max-w-6xl space-y-5 px-5 py-6">
        <SoTActionBar
          left={
            <p className="text-xs text-slate-500">
              Showing {paginatedProducts.length} of {sortedProducts.length} products
            </p>
          }
          right={
            <Link
              to="/products/new"
              className="group inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-3 sm:px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
            </Link>
          }
        />

        <SoTCard className="space-y-5 sm:p-6">
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="space-y-1 lg:col-span-8">
                <label
                  htmlFor="product-search"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  Search
                </label>
                <input
                  id="product-search"
                  type="text"
                  placeholder="Search product name, description, or brand"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-150 placeholder:text-slate-400 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
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
                <span>Target Filter</span>
                <span className="text-slate-500 transition-transform duration-150 group-open:rotate-180">
                  ▼
                </span>
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
                <span>Indication Filters</span>
                <span className="text-slate-500 transition-transform duration-150 group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                <div className="max-h-[190px] overflow-y-auto pr-1">
                  <div className="flex flex-wrap gap-2">
                    {filteredIndications.map((ind) => (
                      <TagCheckbox
                        key={ind.id}
                        label={ind.name}
                        value={ind.name}
                        checked={filterIndications.includes(ind.name)}
                        onChange={(e) => {
                          const updated = e.target.checked
                            ? [...filterIndications, ind.name]
                            : filterIndications.filter((name) => name !== ind.name);
                          setFilterIndications(updated);
                        }}
                      />
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
                hint="Try adjusting filters or add a new product."
                className="mt-1"
              />
            ) : (
              <ProductTable
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
