import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { storage } from "~/utils/storage.server";
import { generateSKU } from "~/utils/skuHelpers";

type ProcessedProductPhotoUpload = {
  slot: number;
  fileKey: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
};

type ExistingProductForUpsert = {
  photos: Array<{
    slot: number;
    fileKey: string;
    fileUrl: string;
  }>;
} | null;

type PersistProductPhotosResult = {
  cover: { fileUrl: string; fileKey: string } | null;
  replacedKeys: string[];
};

type PersistProductPhotos = (
  productId: number,
  previousPhotos: Array<{ slot: number; fileKey: string; fileUrl: string }>
) => Promise<PersistProductPhotosResult>;

function parseMoneyNumber(value: FormDataEntryValue | null, fallback = 0) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "-.") {
    return fallback;
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function r2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function runProductUpsertAction({
  formData,
  existingProduct,
  processedPhotoUploads,
  persistProductPhotos,
}: {
  formData: FormData;
  existingProduct: ExistingProductForUpsert;
  processedPhotoUploads: ProcessedProductPhotoUpload[];
  persistProductPhotos: PersistProductPhotos;
}) {
  const id = formData.get("id")?.toString();
  const productId = id ? Number(id) : null;
  if (id && (!Number.isFinite(productId) || !productId || productId <= 0)) {
    return json({ success: false, error: "Invalid product ID." }, { status: 400 });
  }

  const currentProduct = productId
    ? await db.product.findUnique({
        where: { id: productId },
        select: { id: true, categoryId: true },
      })
    : null;

  if (productId && !currentProduct) {
    return json({ success: false, error: "Product not found." }, { status: 404 });
  }

  const name = formData.get("name")?.toString().trim() || "";
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
    ? await db.category.findUnique({
        where: { id: categoryId },
        select: { id: true, name: true, isActive: true },
      })
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
  const sku = formData.get("sku")?.toString().trim() || "";
  const finalSku =
    sku ||
    generateSKU({ category: categoryNameFromDb, brand: brandName, name });

  const indicationIdsRaw = (formData.getAll("indicationIds") as string[])
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const targetIdsRaw = (formData.getAll("targetIds") as string[])
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const newIndications = formData.getAll("newIndications") as string[];
  const newTargets = formData.getAll("newTargets") as string[];
  const decimals = (packingStockRaw.split(".")[1] || "").length;

  let finalImageUrl: string | undefined;
  if (processedPhotoUploads.length > 0) {
    const coverUpload = [...processedPhotoUploads].sort((a, b) => a.slot - b.slot)[0];
    finalImageUrl = coverUpload?.fileUrl ?? finalImageUrl;
  }

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

  if (!category) {
    return json({ success: false, error: "Invalid category selected." }, { status: 400 });
  }

  const keepingCurrentArchivedCategory =
    Boolean(currentProduct) && currentProduct?.categoryId === categoryId;
  if (!category.isActive && !keepingCurrentArchivedCategory) {
    return json(
      {
        success: false,
        error: `Category "${category.name}" is archived. Select an active category.`,
        field: "categoryId",
      },
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

  if (unitId) {
    const valid = await db.unit.findUnique({ where: { id: unitId } });
    if (!valid) {
      return json(
        { success: false, error: "Invalid retail unit selected." },
        { status: 400 }
      );
    }
  }

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
    if (!category.isActive) {
      return json(
        {
          success: false,
          error: `Cannot create brand under archived category "${category.name}".`,
          field: "brandName",
        },
        { status: 400 }
      );
    }
    const existing = await db.brand.findFirst({
      where: { name: { equals: brandName, mode: "insensitive" }, categoryId },
    });
    if (existing) {
      return json(
        { success: false, error: "Brand already exists.", field: "brandName" },
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
  if (newIndications.some((value) => value.trim()) && !category.isActive) {
    return json(
      {
        success: false,
        error: `Cannot create indications under archived category "${category.name}".`,
        field: "categoryId",
      },
      { status: 400 }
    );
  }
  for (const item of newIndications.map((value) => value.trim()).filter(Boolean)) {
    const existing = await db.indication.findFirst({
      where: { name: { equals: item, mode: "insensitive" }, categoryId },
    });
    if (!existing) {
      const indication = await db.indication.create({
        data: { name: item, category: { connect: { id: categoryId! } } },
      });
      createdIndicationIds.push(indication.id);
    } else {
      createdIndicationIds.push(existing.id);
    }
  }

  const createdTargetIds: number[] = [];
  if (newTargets.some((value) => value.trim()) && !category.isActive) {
    return json(
      {
        success: false,
        error: `Cannot create targets under archived category "${category.name}".`,
        field: "categoryId",
      },
      { status: 400 }
    );
  }
  for (const item of newTargets.map((value) => value.trim()).filter(Boolean)) {
    const existing = await db.target.findFirst({
      where: { name: { equals: item, mode: "insensitive" }, categoryId },
    });
    if (!existing) {
      const target = await db.target.create({
        data: { name: item, category: { connect: { id: categoryId! } } },
      });
      createdTargetIds.push(target.id);
    } else {
      createdTargetIds.push(existing.id);
    }
  }

  const indicationIds = Array.from(
    new Set([...indicationIdsRaw, ...createdIndicationIds])
  );
  const targetIds = Array.from(new Set([...targetIdsRaw, ...createdTargetIds]));

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
    if (productId) {
      const indIds = [
        ...new Set(
          [...(indicationIds ?? []), ...(createdIndicationIds ?? [])].map(Number)
        ),
      ];
      const tgtIds = [
        ...new Set(
          [...(targetIds ?? []), ...(createdTargetIds ?? [])].map(Number)
        ),
      ];

      await db.product.update({
        where: { id: productId },
        data: {
          ...commonData,
          productIndications: {
            deleteMany: {},
            create: indIds.map((indId) => ({
              indication: { connect: { id: indId } },
            })),
          },
          productTargets: {
            deleteMany: {},
            create: tgtIds.map((targetId) => ({
              target: { connect: { id: targetId } },
            })),
          },
        },
      });

      if (processedPhotoUploads.length > 0) {
        const persisted = await persistProductPhotos(productId, existingProduct?.photos ?? []);
        finalImageUrl = persisted.cover?.fileUrl ?? finalImageUrl;

        const keysToDelete = new Set(persisted.replacedKeys);
        for (const oldKey of keysToDelete) {
          try {
            await storage.delete(oldKey);
          } catch (error) {
            console.warn("delete old image failed", error);
          }
        }
      }

      return json({
        success: true,
        action: "updated",
        id: productId,
        ...(finalImageUrl !== undefined ? { imageUrl: finalImageUrl } : {}),
      });
    }

    const createdProduct = await db.product.create({
      data: {
        ...commonData,
        productIndications: {
          create: [...indicationIds, ...createdIndicationIds].map((indicationId) => ({
            indication: { connect: { id: indicationId } },
          })),
        },
        productTargets: {
          create: [...targetIds, ...createdTargetIds].map((targetId) => ({
            target: { connect: { id: targetId } },
          })),
        },
      },
    });

    if (processedPhotoUploads.length > 0) {
      const persisted = await persistProductPhotos(createdProduct.id, []);
      finalImageUrl = persisted.cover?.fileUrl ?? finalImageUrl;
    }

    return json({
      success: true,
      action: "created",
      id: createdProduct.id,
      ...(finalImageUrl !== undefined ? { imageUrl: finalImageUrl } : {}),
    });
  } catch (error: unknown) {
    console.error("[❌ Product action error]:", error);
    const message = error instanceof Error ? error.message : "Saving failed";
    return json({ success: false, error: message || "Saving failed" }, { status: 500 });
  }
}
