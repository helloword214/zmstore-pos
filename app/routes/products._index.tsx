import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { db } from "~/utils/db.server";
import { FormSection } from "~/components/ui/FormSection";
import { FormGroupRow } from "~/components/ui/FormGroupRow";
import { TextInput } from "~/components/ui/TextInput";
import { SelectInput } from "~/components/ui/SelectInput";
import { DeletableSmartSelectInput } from "~/components/ui/DeletableSmartSelectInput";
import { Button } from "~/components/ui/Button";
import { Textarea } from "~/components/ui/Textarea";
import { TagCheckbox } from "~/components/ui/TagCheckbox";
import { ProductTable } from "~/components/ui/ProductTable";
import { Pagination } from "~/components/ui/Pagination";
import { CurrencyInput } from "~/components/ui/CurrencyInput";
import { ComboInput } from "~/components/ui/ComboInput";
import { MultiSelectInput } from "~/components/ui/MultiSelectInput";
import { generateSKU } from "~/utils/skuHelpers";
import { clsx } from "clsx";
import { Toast } from "~/components/ui/Toast";
import { ManageOptionModal } from "~/components/ui/ManageOptionModal";

import type {
  LoaderData,
  ProductWithDetails,
  Brand,
  SelectOption,
} from "~/types";

// Define a LoaderData interface somewhere in this file (or import it)

// Type

export async function loader() {
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

  console.log("[📦 Loaded products]:", products.length);

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
    targets: p.productTargets.map((pt) => ({
      id: pt.target.id,
      name: pt.target.name,
    })),
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
      const key = `${t.name.trim().toLowerCase()}::${cId ?? "null"}::${
        bId ?? "null"
      }`;
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
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const toggleId = formData.get("toggleId");
  const newIsActive = formData.get("isActive");

  if (toggleId && newIsActive !== null) {
    await db.product.update({
      where: { id: Number(toggleId) },
      data: { isActive: newIsActive === "true" },
    });

    return json({ success: true, action: "toggled" });
  }

  // Delete flow
  const deleteId = formData.get("deleteId")?.toString();
  if (deleteId) {
    await db.product.delete({ where: { id: Number(deleteId) } });
    return json({ success: true, action: "deleted" });
  }

  // Common fields
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim() || "";
  const price = parseFloat(formData.get("price")?.toString() || "0");
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
  const stock = parseFloat(formData.get("stock")?.toString() || "0");
  const packingStockRaw = formData.get("packingStock")?.toString() || "0";
  const packingStock = parseFloat(packingStockRaw);
  const dealerPrice = parseFloat(
    formData.get("dealerPrice")?.toString() || "0"
  );
  const srp = parseFloat(formData.get("srp")?.toString() || "0");
  const packingSize = parseFloat(
    formData.get("packingSize")?.toString() || "0"
  );
  const expiration = formData.get("expirationDate")?.toString();
  const replenishAt = formData.get("replenishAt")?.toString();
  const imageTag = formData.get("imageTag")?.toString().trim();
  const imageUrl = formData.get("imageUrl")?.toString().trim();
  const description = formData.get("description")?.toString();
  const barcode = formData.get("barcode")?.toString() || undefined;
  const minStock = formData.get("minStock")
    ? parseFloat(formData.get("minStock")!.toString())
    : undefined;
  const locationIdRaw = formData.get("locationId")?.toString().trim();
  const isCustom = locationIdRaw === "__custom__";
  const customLocationName = isCustom
    ? formData.get("customLocationName")?.toString().trim()
    : undefined;
  const isActive = formData.get("isActive")?.toString() !== "false"; // default true
  const allowPackSale = formData.get("allowPackSale") === "true";
  const sku = formData.get("sku")?.toString().trim() || "";
  const finalSku =
    sku ||
    generateSKU({ category: categoryNameFromDb, brand: brandName, name });

  // ** NEW **: parse multi-value fields
  const indicationIds = (formData.getAll("indicationIds") as string[])
    .map((s) => parseInt(s, 10))
    .filter(Boolean);

  const targetIds = (formData.getAll("targetIds") as string[])
    .map((s) => parseInt(s, 10))
    .filter(Boolean);

  const newIndications = formData.getAll("newIndications") as string[];
  const newTargets = formData.getAll("newTargets") as string[];
  const decimals = (packingStockRaw.split(".")[1] || "").length;

  //deletaion LOGIC
  const actionType = formData.get("_action")?.toString();

  //delete ----- location
  const locationIdToDelete = formData.get("locationId")?.toString();

  if (actionType === "delete-location") {
    if (!locationIdToDelete) {
      return json(
        { success: false, error: "❌ Missing location ID to delete." },
        { status: 400 }
      );
    }

    const id = Number(locationIdToDelete);
    if (isNaN(id)) {
      return json(
        { success: false, error: "❌ Invalid location ID." },
        { status: 400 }
      );
    }

    const productsUsingLocation = await db.product.count({
      where: { locationId: id },
    });

    if (productsUsingLocation > 3) {
      return json(
        {
          success: false,
          error: `❌ Cannot delete: used by ${productsUsingLocation} product(s). Limit is 3.`,
        },
        { status: 400 }
      );
    }

    await db.location.delete({ where: { id } });

    return json({
      success: true,
      action: "delete-location",
    });
  }

  // deletete  ---- brand logic

  const brandIdToDelete = formData.get("brandId")?.toString();

  if (actionType === "delete-brand" && brandIdToDelete) {
    const id = Number(brandIdToDelete);

    // Check if any product is using this brand
    const productsUsingBrand = await db.product.count({
      where: { brandId: id },
    });

    if (productsUsingBrand > 3) {
      return json(
        {
          success: false,
          error: `❌ Cannot delete brand: used by ${productsUsingBrand} product(s).`,
        },
        { status: 400 }
      );
    }

    // Proceed to delete from DB
    await db.brand.delete({ where: { id } });

    return json({
      success: true,
      action: "delete-brand",
    });
  }

  //delete inidcation

  const indicationIdToDelete = formData.get("indicationId")?.toString();

  if (actionType === "delete-indication" && indicationIdToDelete) {
    const id = Number(indicationIdToDelete);

    // Check if any product is using this indication
    const productsUsingIndication = await db.productIndication.count({
      where: { indicationId: id },
    });

    if (productsUsingIndication > 100) {
      return json(
        {
          success: false,
          error: `❌ Cannot delete indication: used by ${productsUsingIndication} product(s).`,
        },
        { status: 400 }
      );
    }

    // Proceed to delete from DB
    await db.indication.delete({ where: { id } });

    return json({
      success: true,
      action: "delete-indication",
    });
  }

  //delation target
  const targetIdToDelete = formData.get("targetId")?.toString();

  if (actionType === "delete-target" && targetIdToDelete) {
    const id = Number(targetIdToDelete);

    await db.target.delete({ where: { id } });

    return json({ success: true, action: "delete-target" });
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

  let resolvedLocationId: number | undefined = locationIdRaw
    ? parseInt(locationIdRaw)
    : undefined;

  if (customLocationName && !resolvedLocationId) {
    const existingLocation = await db.location.findFirst({
      where: { name: { equals: customLocationName, mode: "insensitive" } },
    });

    if (existingLocation) {
      resolvedLocationId = existingLocation.id;
    } else {
      const newLocation = await db.location.create({
        data: { name: customLocationName },
      });
      resolvedLocationId = newLocation.id;
    }
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
    imageUrl,
    description,
    minStock,
    isActive,
    allowPackSale,
    location: resolvedLocationId
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
      await db.product.update({
        where: { id: Number(id) },
        data: {
          ...commonData,
          productIndications: {
            deleteMany: {},
            create: [...indicationIds, ...createdIndicationIds].map(
              (indId) => ({
                indication: { connect: { id: indId } },
              })
            ),
          },
          productTargets: {
            deleteMany: {},
            create: [...targetIds, ...createdTargetIds].map((tId) => ({
              target: { connect: { id: tId } },
            })),
          },
        },
      });
      return json({ success: true, action: "updated" });
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

      return json({ success: true, action: "created", id: createdProduct.id });
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
    units,
    packingUnits,
    indications,
    targets,
    locations,
  } = useLoaderData<LoaderData>();

  // — State & Options —
  const [products, setProducts] =
    useState<ProductWithDetails[]>(initialProducts);
  const [brands, setBrands] = useState<Brand[]>(initialBrands);

  const [selectedIndications, setSelectedIndications] = useState<
    { label: string; value: string }[]
  >([]);

  const [selectedTargets, setSelectedTargets] = useState<
    { label: string; value: string }[]
  >([]);

  const [targetOptions, setTargetOptions] = useState<
    { label: string; value: string }[]
  >([]);

  const [indicationOptions, setIndicationOptions] = useState<
    { label: string; value: string }[]
  >([]);

  const [locationOptions, setLocationOptions] = useState<SelectOption[]>([]);
  const [brandOptions, setBrandOptions] = useState<SelectOption[]>([]);

  const [customLocationName, setCustomLocationName] = useState("");

  // -fetcher for reloading after create/update/delete-
  const actionFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    field?: string;
    action?:
      | "created"
      | "updated"
      | "deleted"
      | "toggled"
      | "delete-location"
      | "delete-brand";
    id?: number; //
  }>();
  const listFetcher = useFetcher<{ products: ProductWithDetails[] }>();
  const brandsFetcher = useFetcher<{ brands: Brand[] }>();

  // - modal & Form state -
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Record<string, string>>({
    target: "", // ✅ ensure this is always a string
    indication: "", // ✅ same for uses
    location: "",
  });
  const [showManageIndication, setShowManageIndication] = useState(false);
  const [showManageTarget, setShowManageTarget] = useState(false);

  const [showAlert, setShowAlert] = useState(false);

  // — Filters & Paging —
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterTarget, setFilterTarget] = useState("");
  const [filterIndications, setFilterIndications] = useState<string[]>([]);

  const itemsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const fetcher = useFetcher<{ products: ProductWithDetails[] }>();

  const filteredIndications = indications.filter(
    (ind) => !filterCategory || ind.categoryId === Number(filterCategory)
  );

  // — Messages & Errors —
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // ---  ui / ux  ----
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  //-------Effects ----------------------------------------------------------

  // Unified product list updater
  // note: 🔁 Track last search term to avoid unnecessary page reset
  const prevSearchTermRef = useRef("");

  // 🔁 Track previous filters
  const prevFiltersRef = useRef({
    filterCategory: "",
    filterBrand: "",
    filterTarget: "",
    filterIndications: [] as string[],
  });

  //delete location

  const getLabelFromValue = useCallback(
    (val: string | number): string => {
      const found = locationOptions.find(
        (opt) => String(opt.value) === String(val)
      );
      return found?.label || `Location #${val}`;
    },
    [locationOptions]
  );

  const getLabelFromValueBrand = useCallback(
    (val: string | number): string => {
      const found = brandOptions.find(
        (opt) => String(opt.value) === String(val)
      );
      return found?.label || `Brand #${val}`;
    },
    [brandOptions]
  );

  useEffect(() => {
    if (!locations || locations.length === 0) return;

    setLocationOptions(
      locations.map((loc) => ({
        label: loc.name,
        value: String(loc.id),
      }))
    );
  }, [locations]);

  useEffect(() => {
    if (!brands || brands.length === 0) return;

    setBrandOptions(
      brands.map((b) => ({
        label: b.name,
        value: String(b.id),
      }))
    );
  }, [brands]);

  useEffect(() => {
    setIndicationOptions(
      indications.map((ind) => ({
        label: ind.name,
        value: String(ind.id),
      }))
    );
  }, [indications]);

  useEffect(() => {
    // 1) filter targets by selected Category + Brand
    const filtered = targets.filter((t: any) => {
      const okCat =
        !filterCategory || String(t.categoryId ?? "") === filterCategory;
      const okBr = !filterBrand || String(t.brandId ?? "") === filterBrand;
      return okCat && okBr;
    });

    // 2) dedupe by name (case-insensitive)
    const seen = new Set<string>();
    const opts = filtered
      .filter((t: any) => {
        const key = t.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((t: any) => ({ label: t.name, value: String(t.id) }));

    setTargetOptions(opts);

    // 3) clear selection if no longer valid
    if (filterTarget && !opts.some((o) => o.value === filterTarget)) {
      setFilterTarget("");
    }
  }, [targets, filterCategory, filterBrand, filterTarget]);

  // 🧠 When fetcher gets search result, update products and reset page only if search term changed
  useEffect(() => {
    if (fetcher.data?.products) {
      setProducts(fetcher.data.products);

      if (searchTerm !== prevSearchTermRef.current) {
        setCurrentPage(1);
        prevSearchTermRef.current = searchTerm;
      }
    }
  }, [fetcher.data, searchTerm]);

  // 🧠 When full list fetcher returns data (initial load or after create/update/delete)
  useEffect(() => {
    if (listFetcher.data?.products) {
      const sorted = [...listFetcher.data.products].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setProducts(sorted);
    }
  }, [listFetcher.data]);

  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.filterCategory !== filterCategory ||
      prev.filterBrand !== filterBrand ||
      prev.filterTarget !== filterTarget ||
      JSON.stringify(prev.filterIndications) !==
        JSON.stringify(filterIndications);

    if (changed) {
      setCurrentPage(1);
      prevFiltersRef.current = {
        filterCategory,
        filterBrand,
        filterTarget,
        filterIndications,
      };
    }
  }, [filterCategory, filterBrand, filterTarget, filterIndications]);

  // when brands api returns fresh data:
  useEffect(() => {
    if (brandsFetcher.data?.brands) {
      setBrands(brandsFetcher.data.brands);
    }
  }, [brandsFetcher.data]);

  // Scroll to table (only when filters or page changes, not every keystroke)
  useEffect(() => {
    const timeout = setTimeout(() => {
      const anchor = document.getElementById("table-anchor");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth" });
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterCategory, filterBrand, filterTarget, filterIndications]);

  // Handle create/update/delete feedback:

  const formRef = useRef<HTMLFormElement>(null);

  //sku ito yung nawawala
  useEffect(() => {
    if (!userEditedSku.current) {
      const cat =
        categories.find((c) => String(c.id) === String(formData.categoryId))
          ?.name || "";
      const br =
        brands.find((b) => String(b.id) === String(formData.brandId))?.name ||
        formData.brandName ||
        "";
      const nm = formData.name || "";

      if (nm && (cat || br)) {
        setFormData((prev) => ({
          ...prev,
          sku: generateSKU({ category: cat, brand: br, name: nm }),
        }));
      } else if (formData.sku) {
        setFormData((prev) => ({ ...prev, sku: "" }));
      }
    }
    // eslint-disable-next-line
  }, [
    formData.categoryId,
    formData.brandId,
    formData.brandName,
    formData.name,
    categories,
    brands,
  ]);

  // Handle create/update/delete feedback: dito may chnages
  useEffect(() => {
    const data = actionFetcher.data;
    if (!data) return;
    const { success, error, action, field } = data;

    if (success) {
      const msgMap = {
        created: "✅ Product successfully saved.",
        updated: "✏️ Product successfully updated.",
        deleted: "🗑️ Product deleted successfully.",
        toggled: "Product status updated!",
        "delete-location": "📍 Location deleted successfully.",
        "delete-brand": "📍 Brand deleted successfully.",
      };

      setSuccessMsg(msgMap[action || "created"] || "✅ Operation completed.");
      setErrorMsg("");
      setShowAlert(true);

      // 🔶 Highlight logic here:
      if (formData.id) {
        // Updated product
        setHighlightId(Number(formData.id));
      } else if (data.id) {
        // Newly created product (from action response)
        setHighlightId(Number(data.id));
      }

      // Reset highlight after 3 seconds
      setTimeout(() => setHighlightId(null), 3000);

      setTimeout(() => {
        setShowModal(false);
        setFormData({});
        setStep(1);
        setErrors({});
        if (formRef.current) formRef.current.reset();
      }, 1600);

      listFetcher.load("/products");
      brandsFetcher.load("/brands/api");
      actionFetcher.data = undefined;

      setTimeout(() => {
        setShowAlert(false);
        actionFetcher.data = undefined;
      }, 2000);
    }

    if (error) {
      if (field) {
        setErrors((prev) => ({ ...prev, [field]: error }));

        const el = document.querySelector(`[name="${field}"]`);
        if (el && "scrollIntoView" in el) {
          (el as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      } else {
        setErrorMsg(error);
        setShowAlert(true); // 👈 show error
        setTimeout(() => setShowAlert(false), 2500);
      }
      setSuccessMsg("");
      setSearchTerm("");

      setTimeout(() => {
        actionFetcher.data = undefined;
      }, 300);
    }
  }, [
    actionFetcher, // entire fetcher object
    actionFetcher.data, // specifically tracks data changes
    brandsFetcher,
    listFetcher,
    formData.id, // primitive string or number
  ]);

  //hande location and brand delete logic
  useEffect(() => {
    const data = actionFetcher.data;
    if (!data || !data.success) return;

    const submission = (actionFetcher as any).submission;

    if (data.action === "delete-location") {
      const deletedId = String(submission?.formData.get("locationId"));
      const rawLabel = getLabelFromValue(deletedId); // from your utility
      const label =
        typeof rawLabel === "string" ? rawLabel : `Location #${deletedId}`;

      setLocationOptions((prev) =>
        prev.filter((opt) => String(opt.value) !== deletedId)
      );

      if (formData.locationId === deletedId) {
        setFormData((prev) => ({ ...prev, locationId: "" }));
      }

      if (customLocationName === deletedId) {
        setCustomLocationName("");
      }

      setSuccessMsg(`Deleted "${label}" from the list.`);
      setShowAlert(true);
      return;
    }

    if (data.action === "delete-brand") {
      const deletedId = String(submission?.formData.get("brandId"));

      const rawLabel = getLabelFromValueBrand(deletedId); // ✅ Reuse this
      const label =
        typeof rawLabel === "string" ? rawLabel : `Brand #${deletedId}`;

      setBrandOptions((prev) =>
        prev.filter((opt) => String(opt.value) !== deletedId)
      );

      if (formData.brandId === deletedId) {
        setFormData((prev) => ({ ...prev, brandId: "" }));
      }

      setSuccessMsg(`Deleted "${label}" from the brand list.`);
      setShowAlert(true);
    }
  }, [
    actionFetcher.data,
    actionFetcher,
    getLabelFromValue,
    setLocationOptions,
    setBrandOptions,
    setFormData,
    setCustomLocationName,
    formData.locationId,
    formData.brandId,
    customLocationName,
    setSuccessMsg,
    setShowAlert,
    getLabelFromValueBrand,
  ]);

  const userEditedSku = useRef(false);

  function handleOpenModal() {
    formRef.current?.reset();

    setFormData({
      locationId: "", // default or preserved value, not full reset
      // add default fields here as needed
    });

    setStep(1);
    setErrors({});
    setSuccessMsg("");
    setErrorMsg("");
    setShowModal(true);
  }

  //multiselectinput indication logic
  async function handleCustomIndication(
    input: string
  ): Promise<{ label: string; value: string }> {
    const name = input.trim();

    if (!name || !formData.categoryId) {
      alert("Please enter an indication and select a category first.");
      return Promise.reject();
    }

    try {
      const response = await fetch("/indication/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          categoryId: Number(formData.categoryId),
        }),
      });

      const result = await response.json();

      if (result?.error) {
        alert(result.error);
        return Promise.reject();
      }

      return {
        label: result.name,
        value: result.id.toString(), // ← IMPORTANT: use the unique ID
      };
    } catch (err) {
      console.error("Error creating indication:", err);
      alert("Something went wrong while creating the indication.");
      return Promise.reject();
    }
  }

  //multiselectinput tartget logic
  async function handleCustomTarget(
    input: string
  ): Promise<{ label: string; value: string }> {
    const name = input.trim();

    if (!name || !formData.categoryId) {
      alert("Please enter a target name and select a category first.");
      return Promise.reject();
    }

    try {
      const response = await fetch("/target/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          categoryId: Number(formData.categoryId),
        }),
      });

      const result = await response.json();

      if (result?.error) {
        alert(result.error);
        return Promise.reject();
      }

      return {
        label: result.name,
        value: result.id.toString(), // must return ID
      };
    } catch (err) {
      console.error("Error creating target:", err);
      alert("Something went wrong while creating the target.");
      return Promise.reject();
    }
  }

  function handleInput(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) {
    const { name, value } = e.target;

    const cleaned = [
      "price",
      "srp",
      "dealerPrice",
      "stock",
      "packingStock",
      "minStock",
    ].includes(name)
      ? value.replace(/[^0-9.]/g, "")
      : value;

    const disallowNegative = [
      "price",
      "srp",
      "dealerPrice",
      "stock",
      "packingStock",
      "minStock",
    ];
    if (disallowNegative.includes(name) && parseFloat(cleaned) < 0) {
      return; // Skip setting negative value
    }

    setFormData((prev) => ({ ...prev, [name]: cleaned }));
  }

  function handleDeleteLocation(valueToDelete: string | number) {
    const label =
      getLabelFromValue(valueToDelete) || `Location #${valueToDelete}`;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${label}"?`
    );
    if (!confirmDelete) return;

    const payLoad = new FormData();
    payLoad.append("_action", "delete-location"); // 🔑 must match in action
    payLoad.append("locationId", String(valueToDelete)); // 🔑 used in action

    actionFetcher.submit(payLoad, { method: "post" });
  }

  function handleDeleteBrand(valueToDelete: string | number) {
    const label = getLabelFromValue(valueToDelete) || `Brand #${valueToDelete}`;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${label}"?`
    );
    if (!confirmDelete) return;

    const payLoad = new FormData();
    payLoad.append("_action", "delete-brand"); // 🔑 must match in action
    payLoad.append("brandId", String(valueToDelete)); // 🔑 used in action

    actionFetcher.submit(payLoad, { method: "post" });
  }

  function handleDeleteIndication(valueToDelete: string | number) {
    const label =
      indicationOptions.find(
        (opt) => String(opt.value) === String(valueToDelete)
      )?.label || `Indication #${valueToDelete}`;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${label}"?`
    );
    if (!confirmDelete) return;

    const payLoad = new FormData();
    payLoad.append("_action", "delete-indication");
    payLoad.append("indicationId", String(valueToDelete));

    actionFetcher.submit(payLoad, { method: "post" });
  }

  function handleDeleteTarget(valueToDelete: string | number) {
    const label =
      targetOptions.find((t) => String(t.value) === String(valueToDelete))
        ?.label || `Target #${valueToDelete}`;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${label}"?`
    );
    if (!confirmDelete) return;

    const payLoad = new FormData();
    payLoad.append("_action", "delete-target");
    payLoad.append("targetId", String(valueToDelete));
    actionFetcher.submit(payLoad, { method: "post" });
  }

  function handleEdit(p: ProductWithDetails) {
    const newFormData = {
      id: String(p.id ?? ""),
      name: p.name ?? "",
      price: String(p.price ?? ""),
      unitId: p.unitId ? String(p.unitId) : "",
      packingUnitId: p.packingUnitId ? String(p.packingUnitId) : "",
      categoryId: String(p.category?.id ?? ""),
      brandId: String(p.brand?.id ?? ""),
      brandName: p.brand?.name ?? "",

      stock: String(p.stock ?? ""),
      dealerPrice: String(p.dealerPrice ?? ""),
      srp: String(p.srp ?? ""),
      packingStock: String(p.packingStock ?? ""),
      packingSize: p.packingSize != null ? String(p.packingSize) : "",
      expirationDate: p.expirationDate
        ? new Date(p.expirationDate).toISOString().slice(0, 10)
        : "",
      replenishAt: p.replenishAt
        ? new Date(p.replenishAt).toISOString().slice(0, 10)
        : "",
      imageTag: p.imageTag ?? "",
      imageUrl: p.imageUrl ?? "",
      description: p.description ?? "",
      sku: p.sku ?? "",
      minStock: String(p.minStock ?? ""),
      locationId: p.location?.id
        ? String(p.location.id)
        : p.locationId
        ? String(p.locationId)
        : "",
      customLocationName:
        p.location?.id && locations.every((l) => l.id !== p.location?.id)
          ? p.location.name
          : "",
      barcode: p.barcode ?? "",
      isActive: p.isActive ? "true" : "false",
      allowPackSale: p.allowPackSale ? "true" : "false",
    };
    console.log("🧪 Editing product:", {
      locationId: p.locationId,
      location: p.location,
    });
    setFormData(newFormData);

    // ✅ Set indication and target multiselect
    setSelectedIndications(
      Array.isArray(p.indications)
        ? p.indications.map((i) => ({
            label: i.name,
            value: String(i.id),
          }))
        : []
    );

    setSelectedTargets(
      Array.isArray(p.targets)
        ? p.targets.map((t) => ({
            label: t.name,
            value: String(t.id),
          }))
        : []
    );

    setStep(1);
    setErrors({});
    setSuccessMsg("");
    setErrorMsg("");

    setTimeout(() => {
      setShowModal(true);
    }, 0);
  }

  // this one nawala
  useEffect(() => {
    if (successMsg || errorMsg) {
      const timer = setTimeout(() => {
        setSuccessMsg("");
        setErrorMsg("");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [successMsg, errorMsg]);

  const filteredProducts = products.filter((p) => {
    const s = searchTerm.trim().toLowerCase();

    const okSearch =
      !s ||
      p.name.toLowerCase().includes(s) ||
      (p.description ?? "").toLowerCase().includes(s) ||
      p.brand?.name.toLowerCase().includes(s);

    const okCat =
      !filterCategory || String(p.categoryId ?? "") === filterCategory;

    const okBr = !filterBrand || String(p.brandId ?? "") === filterBrand;

    const okTg =
      !filterTarget ||
      (p.targets ?? []).some(
        (t) => String(t.id) === filterTarget || t.name === filterTarget // fallback
      );

    const okUse =
      filterIndications.length === 0 ||
      filterIndications.every((u) =>
        (p.indications ?? []).some((i) => i.name === u)
      ); // ✅ updated

    return okSearch && okCat && okBr && okTg && okUse;
  });

  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <main className="min-h-screen bg-slate-900 text-white px-4 py-8">
      {/* title + Add button */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-4">
          🛒 Zaldy Merchandise <span className="text-sm"> Product List</span>
        </h1>
        <button
          onClick={handleOpenModal}
          className="flex round items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          ➕ Add Product
        </button>
      </div>
      {/* Filter panel */}
      <div className="mt-6 rounded-2xl bg-white p-6 shadow-lg space-y-5">
        {/* 🔍 Search + Filters: in one neat row on larger screens */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <TextInput
            label="Search Bar"
            placeholder="🔍 Search product name, description, brand..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full md:col-span-2 border border-gray-300 shadow-sm"
          />

          <SelectInput
            label="Category"
            name="category"
            value={filterCategory}
            onChange={(val) => {
              setFilterCategory(String(val));
              setFilterBrand("");
            }}
            options={[
              { label: "All Categories", value: "", style: { color: "#888" } },
              ...categories.map((c) => ({ label: c.name, value: c.id })),
            ]}
          />

          <DeletableSmartSelectInput
            name="brandId"
            label="Brand"
            value={filterBrand}
            onChange={(val) => setFilterBrand(String(val))}
            options={[
              { label: "All Brands", value: "", style: { color: "#888" } },
              ...brands
                .filter(
                  (b) =>
                    !filterCategory ||
                    b.categoryId?.toString() === filterCategory
                )
                .map((b) => ({
                  label: b.name,
                  value: String(b.id),
                })),
            ]}
            onDeleteOption={handleDeleteBrand}
            deletableValues={brands.map((b) => b.id)} // optional
          />
        </div>
        {/* 🎯 Target Filter as Radio Pills */}
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 mb-2">
            <span>
              🎯 Target Filter{" "}
              <button
                type="button"
                className="text-xs text-gray-500 ml-4 underline"
                onClick={() => setShowManageTarget(true)}
              >
                ⚙️ Manage
              </button>
            </span>

            <span className="text-gray-500 group-open:rotate-180 transition-transform duration-200">
              ▼
            </span>
          </summary>

          <div className="flex flex-wrap gap-2 mt-2">
            {[{ label: "All", value: "" }, ...targetOptions].map((option) => (
              <label
                key={option.value}
                className={clsx(
                  "cursor-pointer px-4 py-1 rounded-full border text-sm transition",
                  filterTarget === option.value
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                )}
              >
                <input
                  type="radio"
                  name="target"
                  value={option.value}
                  className="hidden"
                  checked={filterTarget === option.value}
                  onChange={() => setFilterTarget(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </details>
        {showManageTarget && (
          <ManageOptionModal
            title="Manage Targets"
            options={targetOptions}
            onDelete={handleDeleteTarget}
            onClose={() => setShowManageTarget(false)}
          />
        )}

        {/* 🏷️ Indication Tags: limited height with scroll */}
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 mb-2">
            <span>
              🏷️ Indication Filters{" "}
              <button
                type="button"
                onClick={() => setShowManageIndication(true)}
                className="ml-4 text-xs text-gray-500 hover:text-gray-700 underline"
                title="Manage Indications"
              >
                ⚙️Manage
              </button>
            </span>
            <span className="text-gray-500 group-open:rotate-180 transition-transform duration-200">
              ▼
            </span>
          </summary>

          <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto pr-1 pb-2 mt-2">
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
        </details>

        {showManageIndication && (
          <ManageOptionModal
            title="Manage Indications"
            options={indicationOptions}
            onDelete={handleDeleteIndication}
            onClose={() => setShowManageIndication(false)}
          />
        )}

        {/* 📦 Product Table */}
        <div ref={listRef}>
          {!paginatedProducts.length ? (
            <div className="text-gray-500 italic mt-6 text-center">
              No products available.
            </div>
          ) : (
            <ProductTable
              products={paginatedProducts}
              onEdit={handleEdit}
              onDelete={(id) => {
                const form = new FormData();
                form.append("deleteId", id.toString());
                actionFetcher.submit(form, { method: "post" });
              }}
              highlightId={highlightId}
              actionFetcher={actionFetcher}
            />
          )}

          <Pagination
            currentPage={currentPage}
            totalItems={filteredProducts.length}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>
      {/* Modal: Step 1 / 2 / 3 */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-800 bg-opacity-50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg relative flex flex-col max-h-[90vh]">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-2 right-3 text-xl text-gray-600"
            >
              ×
            </button>

            <actionFetcher.Form
              method="post"
              ref={formRef}
              className="space-y-4 overflow-y-auto flex-1 pr-2 min-h-[500px]"
              onSubmit={(e) => {
                if (!confirm("Are you sure you want to save this product?")) {
                  e.preventDefault();
                }
              }}
            >
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-semibold">
                  {step === 1
                    ? "Step 1: Basic Info"
                    : step === 2
                    ? "Step 2: Stock & Pricing"
                    : "Step 3: Description & Tags"}
                </h2>
                <span className="text-sm text-gray-500">Step {step} of 3</span>
              </div>

              {/* STEP 1: BASIC INFO */}
              {step === 1 && (
                <FormSection
                  title="Step 1: Basic Info"
                  description="Enter the basic product information."
                  bordered
                >
                  {errorMsg && (
                    <div className="bg-red-100 text-red-700 p-2 rounded mb-4 text-sm">
                      {errorMsg}
                    </div>
                  )}

                  <FormGroupRow>
                    <TextInput
                      name="name"
                      label="Product Name"
                      placeholder="Name"
                      value={formData.name || ""}
                      onChange={handleInput}
                      error={errors.name}
                    />
                    <SelectInput
                      name="unitId"
                      label="Unit"
                      value={formData.unitId || ""}
                      onChange={(val) =>
                        setFormData((p) => ({ ...p, unitId: String(val) }))
                      }
                      options={[
                        { label: "-- Unit --", value: "" },
                        ...units.map((u) => ({
                          label: u.name,
                          value: u.id,
                        })),
                      ]}
                      error={errors.unitId}
                    />
                  </FormGroupRow>

                  <FormGroupRow>
                    <SelectInput
                      name="categoryId"
                      label="Category"
                      value={formData.categoryId || ""}
                      onChange={(v) =>
                        setFormData((p) => ({ ...p, categoryId: String(v) }))
                      }
                      options={[
                        {
                          label: "-- Category --",
                          value: "",
                          style: { color: "#888" },
                        },
                        ...categories.map((c) => ({
                          label: c.name,
                          value: c.id,
                        })),
                      ]}
                      error={errors.categoryId}
                    />

                    <ComboInput
                      placeholder="Brand"
                      label="Brand"
                      options={brands
                        .filter(
                          (b) =>
                            !formData.categoryId ||
                            String(b.categoryId) === formData.categoryId
                        )
                        .map((b) => ({ label: b.name, value: b.id }))}
                      selectedId={formData.brandId || ""}
                      customName={formData.brandName || ""}
                      onSelect={({ selectedId, customName }) => {
                        setFormData((prev) => ({
                          ...prev,
                          brandId: selectedId,
                          brandName: customName,
                        }));
                      }}
                      error={errors.brandName}
                    />
                    <input
                      type="hidden"
                      name="brandId"
                      value={formData.brandId || ""}
                    />
                    <input
                      type="hidden"
                      name="brandName"
                      value={formData.brandName || ""}
                    />
                  </FormGroupRow>

                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="checkbox"
                      name="allowPackSale"
                      checked={formData.allowPackSale === "true"}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          allowPackSale: String(e.target.checked), // ✅ Ensure string type
                        }))
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">
                      Sell per kilo (e.g. bigas/feeds/pet-food)
                    </span>
                  </div>
                  <input
                    type="hidden"
                    name="allowPackSale"
                    value={formData.allowPackSale || "false"} // ✅ Ensure hidden value is present
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Don’t check this if your product is sold as a whole unit
                    only (e.g., tank, sack, bottle).
                  </p>

                  <div className="text-right">
                    <Button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();

                        const requiredFields = ["name", "unitId", "categoryId"];
                        const newErrors: Record<string, string> = {};
                        const fieldLabels: Record<string, string> = {
                          name: "Product Name",
                          unit: "Unit",
                          categoryId: "Category",
                        };

                        requiredFields.forEach((field) => {
                          const value = formData[field];
                          const isEmpty =
                            value === undefined ||
                            value === null ||
                            (typeof value === "string" && value.trim() === "");
                          if (isEmpty) {
                            newErrors[
                              field
                            ] = `${fieldLabels[field]} is required`;
                          }
                        });

                        setErrors(newErrors);
                        if (Object.keys(newErrors).length > 0) return;
                        console.log(
                          "📦 Step check: formData.location =",
                          formData.location
                        );

                        if (formData.brandId) {
                          console.log(
                            "📦 Going to Step 2 — current location:",
                            formData.location
                          );

                          setErrorMsg("");
                          setFormData((prev) => ({
                            ...prev,
                            allowPackSale:
                              prev.allowPackSale === "true" ? "true" : "false",
                          }));
                          console.log(
                            "📦 location before step change:",
                            formData.location
                          );

                          setTimeout(() => setStep(2), 50);

                          return;
                        }

                        if (formData.brandName) {
                          const checkData = new FormData();
                          checkData.append(
                            "brandName",
                            formData.brandName.trim()
                          );
                          if (formData.categoryId) {
                            checkData.append("categoryId", formData.categoryId);
                          }

                          try {
                            const res = await fetch("/brand/check", {
                              method: "POST",
                              body: checkData,
                            });
                            const result = await res.json();
                            if (result.exists) {
                              setErrorMsg(
                                `Brand "${formData.brandName}" already exists in this category.`
                              );
                              return;
                            }
                            console.log(
                              "🧪 formData.location before step 2:",
                              formData.location
                            );

                            setErrorMsg("");
                            setStep(2);
                          } catch {
                            setErrorMsg(
                              "Could not verify brand. Please try again."
                            );
                          }
                          return;
                        }

                        setErrorMsg("Please select or enter a valid brand.");
                      }}
                    >
                      Next →
                    </Button>
                  </div>
                </FormSection>
              )}

              {/* STEP 2: STOCK & PRICING */}
              {step === 2 && (
                <FormSection
                  title="Step 2: Stock, Packaging & Pricing"
                  description="Set inventory levels, pricing, and packaging info."
                  bordered
                >
                  {/* Hidden fields from Step 1 */}
                  <input type="hidden" name="id" value={formData.id || ""} />
                  {[
                    "name",
                    "unitId",
                    "categoryId",
                    "brandId",
                    "brandName",
                    "locationId",
                  ].map((key) => (
                    <input
                      key={key}
                      type="hidden"
                      name={key}
                      value={formData[key] || ""}
                    />
                  ))}

                  {/* ✅ Always visible */}
                  <FormGroupRow>
                    {/* Packing Size */}
                    <div className="w-full">
                      <TextInput
                        name="packingSize"
                        label="Packing Size"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 25"
                        value={formData.packingSize || ""}
                        onChange={handleInput}
                        error={errors.packingSize}
                      />
                    </div>

                    {/* Packing Unit Select */}
                    <div className="w-full">
                      <SelectInput
                        name="packingUnitId"
                        label="Packing Unit"
                        value={formData.packingUnitId || ""}
                        onChange={(val) =>
                          setFormData((p) => ({
                            ...p,
                            packingUnitId: String(val),
                          }))
                        }
                        options={[
                          { label: "-- Packing Unit --", value: "" },
                          ...packingUnits.map((u) => ({
                            label: u.name,
                            value: String(u.id), // ✅ ensure string type
                          })),
                        ]}
                        error={errors.packingUnitId}
                      />

                      <input
                        type="hidden"
                        name="packingUnitId"
                        value={formData.packingUnitId || ""}
                      />
                    </div>
                  </FormGroupRow>

                  {/* 📦 Packaging Note */}

                  {/* 💰 Pricing */}
                  <FormGroupRow>
                    <CurrencyInput
                      name="srp"
                      label="Whole Unit Price"
                      placeholder="₱0.00"
                      value={formData.srp || ""}
                      onChange={handleInput}
                      error={errors.srp}
                    />
                    <CurrencyInput
                      name="dealerPrice"
                      label="Cost Price"
                      placeholder="₱0.00"
                      value={formData.dealerPrice || ""}
                      onChange={handleInput}
                      error={errors.dealerPrice}
                    />
                  </FormGroupRow>

                  {/* 🛒 Retail-specific Fields */}
                  {formData.allowPackSale === "true" && (
                    <FormGroupRow>
                      <CurrencyInput
                        name="price"
                        label="Retail Price"
                        placeholder="₱0.00"
                        value={formData.price || ""}
                        onChange={handleInput}
                        error={errors.price}
                      />
                      <TextInput
                        name="packingStock"
                        label="Retail Stock"
                        type="number"
                        placeholder="e.g. 4 (kilos)"
                        value={formData.packingStock || ""}
                        onChange={handleInput}
                        error={errors.packingStock}
                      />
                    </FormGroupRow>
                  )}

                  {/* 📦 Stock for Whole Units */}
                  <FormGroupRow>
                    <TextInput
                      name="stock"
                      label="Stock"
                      type="number"
                      placeholder="e.g. 4 (sacks)"
                      value={formData.stock || ""}
                      onChange={handleInput}
                    />
                  </FormGroupRow>

                  {/* 🏷️ Inventory ID */}
                  <FormGroupRow>
                    <TextInput
                      name="barcode"
                      label="Barcode"
                      placeholder="Barcode"
                      value={formData.barcode || ""}
                      onChange={handleInput}
                    />
                    <TextInput
                      name="sku"
                      label="SKU"
                      placeholder="Auto-generated or manual"
                      value={formData.sku || ""}
                      onChange={handleInput}
                      error={errors.sku}
                    />
                  </FormGroupRow>

                  {/* 📅 Dates */}
                  <FormGroupRow>
                    <TextInput
                      name="expirationDate"
                      label="Expiration Date"
                      type="date"
                      value={formData.expirationDate || ""}
                      onChange={handleInput}
                    />
                    <TextInput
                      name="replenishAt"
                      label="Replenish At"
                      type="date"
                      value={formData.replenishAt || ""}
                      onChange={handleInput}
                    />
                  </FormGroupRow>

                  {/* 🧾 Location & Minimum Stock */}
                  <FormGroupRow>
                    <TextInput
                      name="minStock"
                      label="Min Stock"
                      type="number"
                      placeholder="Trigger alert at..."
                      value={formData.minStock || ""}
                      onChange={handleInput}
                    />
                    <DeletableSmartSelectInput
                      name="locationId"
                      label="Location"
                      value={formData.locationId}
                      onChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          locationId: val,
                        }))
                      }
                      customInputValue={formData.customLocationName || ""}
                      onCustomInputChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          customLocationName: val,
                        }))
                      }
                      customValueLabel="Other"
                      options={locations.map((l) => ({
                        label: l.name,
                        value: String(l.id),
                      }))}
                      onDeleteOption={(val) => handleDeleteLocation(val)}
                      deletableValues={locations.map((l) => l.id)}
                    />

                    <input
                      type="hidden"
                      name="customLocationName"
                      value={formData.customLocationName || ""}
                    />
                    <input
                      type="hidden"
                      name="locationId"
                      value={formData.locationId || ""}
                    />
                  </FormGroupRow>

                  {/* Navigation */}
                  <div className="flex justify-between mt-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep(1)}
                    >
                      ← Back
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        const requiredFields = [
                          "packingSize",
                          "packingUnitId",
                          "srp",
                          "dealerPrice",
                        ];
                        const newErrors: Record<string, string> = {};
                        const fieldLabels: Record<string, string> = {
                          packingSize: "Packing Size",
                          packingUnitId: "Packing Unit",
                          srp: "Whole Unit Price",
                          dealerPrice: "Cost Price",
                        };

                        requiredFields.forEach((field) => {
                          const value = formData[field];
                          const isEmpty =
                            value === undefined ||
                            value === null ||
                            (typeof value === "string" && value.trim() === "");
                          if (isEmpty) {
                            newErrors[
                              field
                            ] = `${fieldLabels[field]} is required`;
                          }
                        });

                        setErrors(newErrors);
                        if (Object.keys(newErrors).length > 0) return;

                        setStep(3);
                      }}
                    >
                      Next →
                    </Button>
                  </div>
                </FormSection>
              )}

              {/* STEP 3: DESCRIPTION & TAGS */}
              {step === 3 && (
                <FormSection
                  title="Step 3: Description & Tags"
                  description="Write a product description, select uses and targets, and upload an image."
                  bordered
                >
                  {[
                    "id",
                    "name",
                    "unitId",
                    "price",
                    "dealerPrice",
                    "srp",
                    "stock",
                    "packingStock",
                    "categoryId",
                    "brandName",
                    "brandId",
                    "sku",
                    "packingSize",
                    "barcode",
                    "expirationDate",
                    "replenishAt",
                    "locationId",
                    "customLocationName",
                    "minStock",
                    "packingUnitId",
                    "allowPackSale",
                  ].map((key) => (
                    <input
                      key={key}
                      type="hidden"
                      name={key}
                      value={formData[key] || ""}
                    />
                  ))}

                  <Textarea
                    name="description"
                    label="Description"
                    placeholder="Product description..."
                    value={formData.description || ""}
                    onChange={handleInput}
                  />

                  <FormSection title="Indications (Uses)">
                    <MultiSelectInput
                      name="indications"
                      label="Indications"
                      options={indications.map((i) => ({
                        label: i.name,
                        value: String(i.id),
                      }))}
                      selected={selectedIndications}
                      onChange={setSelectedIndications}
                      onCustomInput={handleCustomIndication}
                    />
                    {selectedIndications.map((ind) => (
                      <input
                        key={ind.value}
                        type="hidden"
                        name="indicationIds"
                        value={ind.value}
                      />
                    ))}
                  </FormSection>

                  <FormSection title="Target Group">
                    <MultiSelectInput
                      name="target"
                      label="Target"
                      options={targets.map((t) => ({
                        label: t.name,
                        value: String(t.id),
                      }))}
                      selected={selectedTargets}
                      onChange={setSelectedTargets}
                      onCustomInput={handleCustomTarget}
                    />
                    {selectedTargets.map((item, idx) => (
                      <input
                        key={idx}
                        type="hidden"
                        name="targetIds"
                        value={item.value}
                      />
                    ))}
                  </FormSection>

                  <FormGroupRow>
                    <TextInput
                      name="imageTag"
                      label="Image Tag"
                      placeholder="e.g. vitamins_icon"
                      value={formData.imageTag || ""}
                      onChange={handleInput}
                    />
                    <TextInput
                      name="imageUrl"
                      label="Image URL"
                      placeholder="https://example.com/image.jpg"
                      value={formData.imageUrl || ""}
                      onChange={handleInput}
                    />
                  </FormGroupRow>

                  <div className="flex justify-between mt-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep(2)}
                    >
                      ← Back
                    </Button>
                    <Button type="submit" variant="primary">
                      Save
                    </Button>
                  </div>
                </FormSection>
              )}
            </actionFetcher.Form>
          </div>
        </div>
      )}

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
