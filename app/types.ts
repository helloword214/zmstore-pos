import type {
  Indication,
  Target,
  Product as PrismaProduct,
  Brand as PrismaBrand,
  Location as PrismaLocation,
  Unit as PrismaUnit,
  PackingUnit as PrismaPackingUnit,
} from "@prisma/client";

// ✅ Aliases for consistency
export type Brand = PrismaBrand;
export type Category = { id: number; name: string };
export type Unit = PrismaUnit;
export type PackingUnit = PrismaPackingUnit;
export type Location = PrismaLocation;

// ✅ Product with all frontend-friendly fields
export type ProductWithDetails = PrismaProduct & {
  indications: { id: number; name: string }[];
  targets: { id: number; name: string }[];

  categoryId?: number | null;
  brandId?: number | null;
  unitId?: number | null;
  packingUnitId?: number | null;
  locationId?: number | null;

  category: Category | null;
  brand: Brand | null;
  unit: Unit | null;
  packingUnit: PackingUnit | null;
  location: Location | null;

  // Flattened fields for UI display
  unitName?: string;
  packingUnitName?: string;
  locationName?: string;
};

// ✅ Loader return shape
export type LoaderData = {
  products: ProductWithDetails[];
  categories: Category[];
  brands: Brand[];
  units: Unit[]; // Retail units (e.g. kg, capsule)
  packingUnits: PackingUnit[]; // Containers (e.g. sack, bottle)
  indications: Indication[];
  targets: Target[];
  locations: Location[];
};
