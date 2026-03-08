import { db } from "~/utils/db.server";
import type {
  ProductFormInitialData,
  ProductFormReferenceData,
} from "~/components/products/ProductUpsertForm";

export async function getProductFormReferences(options?: {
  includeCategoryId?: number | null;
}): Promise<ProductFormReferenceData> {
  const includeCategoryId = options?.includeCategoryId ?? null;

  const [categories, brands, units, packingUnits, indications, targets, locations] =
    await Promise.all([
      db.category.findMany({
        where: includeCategoryId
          ? {
              OR: [{ isActive: true }, { id: includeCategoryId }],
            }
          : { isActive: true },
        select: { id: true, name: true, isActive: true },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      }),
      db.brand.findMany({ orderBy: { name: "asc" } }),
      db.unit.findMany({ orderBy: { name: "asc" } }),
      db.packingUnit.findMany({ orderBy: { name: "asc" } }),
      db.indication.findMany({
        select: { id: true, name: true, categoryId: true },
        orderBy: { name: "asc" },
      }),
      db.target.findMany({
        select: { id: true, name: true, categoryId: true },
        orderBy: { name: "asc" },
      }),
      db.location.findMany({ orderBy: { name: "asc" } }),
    ]);

  return {
    categories,
    brands,
    units,
    packingUnits,
    indications,
    targets: targets.map((target) => ({ ...target, brandId: null })),
    locations,
    storeCode: process.env.STORE_CODE ?? "00",
  };
}

export async function getProductInitialData(
  productId: number
): Promise<ProductFormInitialData | null> {
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

  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    unitId: product.unit?.id ?? product.unitId,
    categoryId: product.category?.id ?? product.categoryId,
    brandId: product.brand?.id ?? product.brandId,
    brandName: product.brand?.name ?? "",
    allowPackSale: product.allowPackSale,
    packingSize: product.packingSize == null ? null : Number(product.packingSize),
    packingUnitId: product.packingUnit?.id ?? product.packingUnitId,
    srp: product.srp == null ? null : Number(product.srp),
    dealerPrice:
      product.dealerPrice == null ? null : Number(product.dealerPrice),
    price: product.price == null ? null : Number(product.price),
    packingStock:
      product.packingStock == null ? null : Number(product.packingStock),
    stock: product.stock == null ? null : Number(product.stock),
    barcode: product.barcode,
    sku: product.sku,
    expirationDate: product.expirationDate?.toISOString() ?? null,
    replenishAt: product.replenishAt?.toISOString() ?? null,
    minStock: product.minStock == null ? null : Number(product.minStock),
    locationId: product.location?.id ?? product.locationId,
    locationName: product.location?.name ?? null,
    description: product.description,
    imageTag: product.imageTag,
    imageUrl: product.imageUrl,
    photoSlots: product.photos
      .filter((photo, index, list) => {
        const firstIndex = list.findIndex((item) => item.slot === photo.slot);
        return firstIndex === index;
      })
      .map((photo) => ({
        slot: photo.slot,
        fileUrl: photo.fileUrl,
      })),
    isActive: product.isActive,
    indications: product.productIndications.map((entry) => ({
      id: entry.indication.id,
      name: entry.indication.name,
    })),
    targets: product.productTargets.map((entry) => ({
      id: entry.target.id,
      name: entry.target.name,
    })),
  };
}
