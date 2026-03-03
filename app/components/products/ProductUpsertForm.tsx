import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { Button } from "~/components/ui/Button";
import { ComboInput } from "~/components/ui/ComboInput";
import { CurrencyInput } from "~/components/ui/CurrencyInput";
import { FormGroupRow } from "~/components/ui/FormGroupRow";
import { FormSection } from "~/components/ui/FormSection";
import { MultiSelectInput } from "~/components/ui/MultiSelectInput";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTFileInput } from "~/components/ui/SoTFileInput";
import { SelectInput } from "~/components/ui/SelectInput";
import { TextInput } from "~/components/ui/TextInput";
import { Textarea } from "~/components/ui/Textarea";
import { generateSKU } from "~/utils/skuHelpers";
import { makeLocalEan13 } from "~/utils/barcode";

type IdName = { id: number; name: string };

type Category = IdName;
type Brand = IdName & { categoryId: number | null };
type Unit = IdName;
type PackingUnit = IdName;
type Location = IdName;
type Indication = IdName & { categoryId: number | null };
type Target = IdName & { categoryId: number | null; brandId: number | null };

type ProductTagOption = { id: number; name: string };
type ProductPhotoSlot = { slot: number; fileUrl: string };
const PRODUCT_PHOTO_SLOTS = [1, 2, 3, 4] as const;

export type ProductFormReferenceData = {
  categories: Category[];
  brands: Brand[];
  units: Unit[];
  packingUnits: PackingUnit[];
  locations: Location[];
  indications: Indication[];
  targets: Target[];
  storeCode: string;
};

export type ProductFormInitialData = {
  id?: number;
  name?: string;
  unitId?: number | null;
  categoryId?: number | null;
  brandId?: number | null;
  brandName?: string;
  allowPackSale?: boolean;
  packingSize?: number | null;
  packingUnitId?: number | null;
  srp?: number | null;
  dealerPrice?: number | null;
  price?: number | null;
  packingStock?: number | null;
  stock?: number | null;
  barcode?: string | null;
  sku?: string | null;
  expirationDate?: string | null;
  replenishAt?: string | null;
  minStock?: number | null;
  locationId?: number | null;
  locationName?: string | null;
  customLocationName?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  imageTag?: string | null;
  isActive?: boolean;
  photoSlots?: ProductPhotoSlot[];
  indications?: ProductTagOption[];
  targets?: ProductTagOption[];
};

type FormFields = {
  id: string;
  name: string;
  unitId: string;
  categoryId: string;
  brandId: string;
  brandName: string;
  allowPackSale: boolean;
  packingSize: string;
  packingUnitId: string;
  srp: string;
  dealerPrice: string;
  price: string;
  packingStock: string;
  stock: string;
  barcode: string;
  sku: string;
  expirationDate: string;
  replenishAt: string;
  minStock: string;
  locationId: string;
  customLocationName: string;
  description: string;
  imageTag: string;
  imageUrl: string;
  isActive: boolean;
};

type FetcherResponse = {
  success?: boolean;
  error?: string;
  field?: string;
  id?: number;
  action?: string;
};

const INITIAL_FIELDS: FormFields = {
  id: "",
  name: "",
  unitId: "",
  categoryId: "",
  brandId: "",
  brandName: "",
  allowPackSale: false,
  packingSize: "",
  packingUnitId: "",
  srp: "",
  dealerPrice: "",
  price: "",
  packingStock: "",
  stock: "",
  barcode: "",
  sku: "",
  expirationDate: "",
  replenishAt: "",
  minStock: "",
  locationId: "",
  customLocationName: "",
  description: "",
  imageTag: "",
  imageUrl: "",
  isActive: true,
};

function numberToString(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function dateToInput(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function parseLooseNumber(value: string): number {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "-.") {
    return NaN;
  }
  return Number.parseFloat(cleaned);
}

function toTagOption(list?: ProductTagOption[]) {
  return (list ?? []).map((item) => ({
    label: item.name,
    value: String(item.id),
  }));
}

export function ProductUpsertForm({
  mode,
  refs,
  initialProduct,
  uploadSessionKey,
}: {
  mode: "create" | "edit";
  refs: ProductFormReferenceData;
  initialProduct?: ProductFormInitialData;
  uploadSessionKey: string;
}) {
  const navigate = useNavigate();
  const fetcher = useFetcher<FetcherResponse>();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [slotPreviewUrls, setSlotPreviewUrls] = useState<Record<number, string>>({});
  const slotPreviewUrlsRef = useRef<Record<number, string>>({});

  const userEditedPrice = useRef(false);
  const userEditedRetailStock = useRef(false);
  const userEditedSku = useRef(false);

  const initialFields = useMemo<FormFields>(() => {
    if (!initialProduct) return INITIAL_FIELDS;

    const hasKnownLocation =
      initialProduct.locationId != null &&
      refs.locations.some((location) => location.id === initialProduct.locationId);

    return {
      id: initialProduct.id ? String(initialProduct.id) : "",
      name: initialProduct.name ?? "",
      unitId: initialProduct.unitId ? String(initialProduct.unitId) : "",
      categoryId: initialProduct.categoryId ? String(initialProduct.categoryId) : "",
      brandId: initialProduct.brandId ? String(initialProduct.brandId) : "",
      brandName: initialProduct.brandName ?? "",
      allowPackSale: Boolean(initialProduct.allowPackSale),
      packingSize: numberToString(initialProduct.packingSize),
      packingUnitId: initialProduct.packingUnitId
        ? String(initialProduct.packingUnitId)
        : "",
      srp: numberToString(initialProduct.srp),
      dealerPrice: numberToString(initialProduct.dealerPrice),
      price: numberToString(initialProduct.price),
      packingStock: numberToString(initialProduct.packingStock),
      stock: numberToString(initialProduct.stock),
      barcode: initialProduct.barcode ?? "",
      sku: initialProduct.sku ?? "",
      expirationDate: dateToInput(initialProduct.expirationDate),
      replenishAt: dateToInput(initialProduct.replenishAt),
      minStock: numberToString(initialProduct.minStock),
      locationId:
        initialProduct.locationId == null
          ? ""
          : hasKnownLocation
          ? String(initialProduct.locationId)
          : "__custom__",
      customLocationName:
        hasKnownLocation
          ? ""
          : initialProduct.customLocationName ?? initialProduct.locationName ?? "",
      description: initialProduct.description ?? "",
      imageTag: initialProduct.imageTag ?? "",
      imageUrl: initialProduct.imageUrl ?? "",
      isActive: initialProduct.isActive ?? true,
    };
  }, [initialProduct, refs.locations]);

  const [formData, setFormData] = useState<FormFields>(initialFields);

  const initialSelectedIndications = useMemo(
    () => toTagOption(initialProduct?.indications),
    [initialProduct?.indications]
  );
  const initialSelectedTargets = useMemo(
    () => toTagOption(initialProduct?.targets),
    [initialProduct?.targets]
  );

  const [selectedIndications, setSelectedIndications] = useState(
    initialSelectedIndications
  );
  const [selectedTargets, setSelectedTargets] = useState(initialSelectedTargets);

  useEffect(() => {
    setFormData(initialFields);
  }, [initialFields]);

  useEffect(() => {
    setSelectedIndications(initialSelectedIndications);
  }, [initialSelectedIndications]);

  useEffect(() => {
    setSelectedTargets(initialSelectedTargets);
  }, [initialSelectedTargets]);

  useEffect(() => {
    if (mode !== "edit") return;
    userEditedPrice.current = true;
    userEditedRetailStock.current = true;
    userEditedSku.current = Boolean(initialProduct?.sku);
  }, [mode, initialProduct?.id, initialProduct?.sku]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(slotPreviewUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const existingPhotoBySlot = useMemo(() => {
    const map = new Map<number, string>();
    for (const photo of initialProduct?.photoSlots ?? []) {
      if (!map.has(photo.slot)) {
        map.set(photo.slot, photo.fileUrl);
      }
    }
    if (!map.has(1) && initialProduct?.imageUrl) {
      map.set(1, initialProduct.imageUrl);
    }
    return map;
  }, [initialProduct?.photoSlots, initialProduct?.imageUrl]);

  function setSlotPreview(slot: number, file: File | null) {
    setSlotPreviewUrls((prev) => {
      const next = { ...prev };
      const oldUrl = next[slot];
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
        delete next[slot];
      }
      if (file) {
        next[slot] = URL.createObjectURL(file);
      }
      slotPreviewUrlsRef.current = next;
      return next;
    });
  }

  const brandOptions = useMemo(() => {
    const source = formData.categoryId
      ? refs.brands.filter(
          (brand) => String(brand.categoryId ?? "") === formData.categoryId
        )
      : refs.brands;

    return source
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((brand) => ({
        label: brand.name,
        value: String(brand.id),
      }));
  }, [refs.brands, formData.categoryId]);

  const targetOptions = useMemo(() => {
    const source = refs.targets.filter((target) => {
      const categoryMatch =
        !formData.categoryId ||
        String(target.categoryId ?? "") === String(formData.categoryId);

      const brandMatch =
        !formData.brandId ||
        target.brandId == null ||
        String(target.brandId) === String(formData.brandId);

      return categoryMatch && brandMatch;
    });

    const unique = new Map<string, { label: string; value: string }>();
    for (const target of source) {
      const key = target.name.trim().toLowerCase();
      if (!unique.has(key)) {
        unique.set(key, { label: target.name, value: String(target.id) });
      }
    }

    return Array.from(unique.values());
  }, [refs.targets, formData.categoryId, formData.brandId]);

  useEffect(() => {
    const validIds = new Set(targetOptions.map((option) => option.value));
    setSelectedTargets((prev) => prev.filter((option) => validIds.has(option.value)));
  }, [targetOptions]);

  useEffect(() => {
    if (!formData.brandId) return;

    const stillValid = refs.brands.some(
      (brand) =>
        String(brand.id) === formData.brandId &&
        (!formData.categoryId ||
          String(brand.categoryId ?? "") === String(formData.categoryId))
    );

    if (!stillValid) {
      setFormData((prev) => ({ ...prev, brandId: "", brandName: "" }));
      setSelectedTargets([]);
    }
  }, [formData.brandId, formData.categoryId, refs.brands]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.success) {
      const resolvedId =
        Number(fetcher.data.id ?? formData.id ?? initialProduct?.id ?? 0) || 0;
      navigate(resolvedId ? `/products/${resolvedId}` : "/products");
      return;
    }

    if (fetcher.data.error) {
      setErrorMsg(fetcher.data.error);
      if (fetcher.data.field) {
        setErrors((prev) => ({
          ...prev,
          [fetcher.data?.field as string]: fetcher.data?.error ?? "Invalid value",
        }));
      }
    }
  }, [fetcher.state, fetcher.data, formData.id, initialProduct?.id, navigate]);

  useEffect(() => {
    if (userEditedSku.current) return;

    const categoryName =
      refs.categories.find((category) => String(category.id) === formData.categoryId)
        ?.name ?? "";

    const brandName =
      refs.brands.find((brand) => String(brand.id) === formData.brandId)?.name ??
      formData.brandName;

    const productName = formData.name || "";

    if (productName && (categoryName || brandName)) {
      setFormData((prev) => ({
        ...prev,
        sku: generateSKU({
          category: categoryName,
          brand: brandName,
          name: productName,
        }),
      }));
      return;
    }

    if (formData.sku) {
      setFormData((prev) => ({ ...prev, sku: "" }));
    }
  }, [
    refs.categories,
    refs.brands,
    formData.categoryId,
    formData.brandId,
    formData.brandName,
    formData.name,
    formData.sku,
  ]);

  useEffect(() => {
    if (!formData.allowPackSale) return;

    const srp = parseLooseNumber(formData.srp);
    const packingSize = parseLooseNumber(formData.packingSize);

    const canPrice = Number.isFinite(srp) && Number.isFinite(packingSize) && packingSize > 0;
    const canStock = Number.isFinite(packingSize) && packingSize > 0;

    setFormData((prev) => {
      let changed = false;
      const next = { ...prev };

      if (!userEditedPrice.current) {
        if (canPrice) {
          const computedPrice = (Math.round((srp / packingSize) * 100) / 100).toFixed(2);
          if (computedPrice !== prev.price) {
            next.price = computedPrice;
            changed = true;
          }
        } else if (prev.price !== "") {
          next.price = "";
          changed = true;
        }
      }

      if (!userEditedRetailStock.current) {
        if (canStock) {
          const computedStock = String(packingSize);
          if (computedStock !== prev.packingStock) {
            next.packingStock = computedStock;
            changed = true;
          }
        } else if (prev.packingStock !== "") {
          next.packingStock = "";
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [formData.allowPackSale, formData.srp, formData.packingSize]);

  const canRecomputeRetailPrice =
    formData.allowPackSale &&
    Number.isFinite(parseLooseNumber(formData.srp)) &&
    parseLooseNumber(formData.srp) > 0 &&
    Number.isFinite(parseLooseNumber(formData.packingSize)) &&
    parseLooseNumber(formData.packingSize) > 0;

  function recomputeRetailPrice() {
    if (!canRecomputeRetailPrice) {
      setErrors((prev) => ({
        ...prev,
        price: "Enter valid whole price and packing size first.",
      }));
      return;
    }

    userEditedPrice.current = true;

    const srp = parseLooseNumber(formData.srp);
    const packingSize = parseLooseNumber(formData.packingSize);
    const computedPrice = (Math.round((srp / packingSize) * 100) / 100).toFixed(2);

    setErrors((prev) => ({ ...prev, price: "" }));
    setFormData((prev) => ({ ...prev, price: computedPrice }));
  }

  function handleInput(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;

    if (name === "price") userEditedPrice.current = true;
    if (name === "packingStock") userEditedRetailStock.current = true;
    if (name === "sku") userEditedSku.current = true;

    const numericFields = new Set([
      "price",
      "srp",
      "dealerPrice",
      "stock",
      "packingStock",
      "minStock",
      "packingSize",
    ]);

    const cleaned = numericFields.has(name) ? value.replace(/[^0-9.]/g, "") : value;

    if (numericFields.has(name) && Number(cleaned) < 0) {
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: cleaned }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleCustomIndication(input: string) {
    const name = input.trim();
    if (!name || !formData.categoryId) {
      alert("Please enter an indication and choose category first.");
      return Promise.reject();
    }

    try {
      const response = await fetch("/indication/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, categoryId: Number(formData.categoryId) }),
      });

      const result = await response.json();
      if (result?.error) {
        alert(result.error);
        return Promise.reject();
      }

      return {
        label: result.name,
        value: String(result.id),
      };
    } catch {
      alert("Unable to create indication right now.");
      return Promise.reject();
    }
  }

  async function handleCustomTarget(input: string) {
    const name = input.trim();
    if (!name || !formData.categoryId) {
      alert("Please enter a target and choose category first.");
      return Promise.reject();
    }

    try {
      const response = await fetch("/target/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, categoryId: Number(formData.categoryId) }),
      });

      const result = await response.json();
      if (result?.error) {
        alert(result.error);
        return Promise.reject();
      }

      return {
        label: result.name,
        value: String(result.id),
      };
    } catch {
      alert("Unable to create target right now.");
      return Promise.reject();
    }
  }

  return (
    <fetcher.Form
      method="post"
      action="/products"
      encType="multipart/form-data"
      className="space-y-5"
      onSubmit={(event) => {
        if (!window.confirm("Save this product?")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={formData.id} />
      <input type="hidden" name="uploadSessionKey" value={uploadSessionKey} />
      <input
        type="hidden"
        name="allowPackSale"
        value={formData.allowPackSale ? "true" : "false"}
      />
      <input type="hidden" name="isActive" value={formData.isActive ? "true" : "false"} />
      <input type="hidden" name="customLocationName" value={formData.customLocationName} />

      {errorMsg ? (
        <SoTAlert tone="danger">
          {errorMsg}
        </SoTAlert>
      ) : null}

      <FormSection
        title="Basic Info"
        description="Product identity, category mapping, and sell mode."
        bordered
      >
        <FormGroupRow>
          <TextInput
            name="name"
            label="Product Name"
            value={formData.name}
            onChange={handleInput}
            error={errors.name}
          />

          <SelectInput
            label="Unit"
            value={formData.unitId}
            onChange={(value) =>
              setFormData((prev) => ({ ...prev, unitId: String(value) }))
            }
            options={[
              { label: "-- Unit --", value: "" },
              ...refs.units.map((unit) => ({ label: unit.name, value: String(unit.id) })),
            ]}
            error={errors.unitId}
          />
          <input type="hidden" name="unitId" value={formData.unitId} />
        </FormGroupRow>

        <FormGroupRow>
          <SelectInput
            label="Category"
            value={formData.categoryId}
            onChange={(value) =>
              setFormData((prev) => ({
                ...prev,
                categoryId: String(value),
              }))
            }
            options={[
              { label: "-- Category --", value: "" },
              ...refs.categories.map((category) => ({
                label: category.name,
                value: String(category.id),
              })),
            ]}
            error={errors.categoryId}
          />
          <input type="hidden" name="categoryId" value={formData.categoryId} />

          <div>
            <ComboInput
              label="Brand"
              placeholder="Type or select a brand"
              options={brandOptions}
              selectedId={formData.brandId}
              customName={formData.brandName}
              onSelect={({ selectedId, customName }) => {
                setFormData((prev) => ({
                  ...prev,
                  brandId: selectedId,
                  brandName: customName,
                }));
              }}
              error={errors.brandName}
            />
            <input type="hidden" name="brandId" value={formData.brandId} />
            <input type="hidden" name="brandName" value={formData.brandName} />
          </div>
        </FormGroupRow>

        <FormGroupRow>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formData.allowPackSale}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  allowPackSale: event.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            Enable retail selling mode
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formData.isActive}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  isActive: event.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            Product is active
          </label>
        </FormGroupRow>
      </FormSection>

      <FormSection
        title="Stock, Packaging, and Pricing"
        description="Keep pack and retail semantics consistent with current POS behavior."
        bordered
      >
        <FormGroupRow>
          <TextInput
            name="packingSize"
            label="Packing Size"
            type="number"
            step="0.01"
            value={formData.packingSize}
            onChange={handleInput}
            error={errors.packingSize}
          />

          <SelectInput
            label="Packing Unit"
            value={formData.packingUnitId}
            onChange={(value) =>
              setFormData((prev) => ({ ...prev, packingUnitId: String(value) }))
            }
            options={[
              { label: "-- Packing Unit --", value: "" },
              ...refs.packingUnits.map((unit) => ({
                label: unit.name,
                value: String(unit.id),
              })),
            ]}
            error={errors.packingUnitId}
          />
          <input type="hidden" name="packingUnitId" value={formData.packingUnitId} />
        </FormGroupRow>

        <FormGroupRow>
          <CurrencyInput
            name="srp"
            label="Whole Unit Price"
            value={formData.srp}
            onChange={handleInput}
            error={errors.srp}
          />

          <CurrencyInput
            name="dealerPrice"
            label="Cost Price"
            value={formData.dealerPrice}
            onChange={handleInput}
            error={errors.dealerPrice}
          />
        </FormGroupRow>

        {formData.allowPackSale ? (
          <FormGroupRow>
            <div>
              <CurrencyInput
                name="price"
                label="Retail Price"
                value={formData.price}
                onChange={handleInput}
                error={errors.price}
              />
              <button
                type="button"
                onClick={recomputeRetailPrice}
                disabled={!canRecomputeRetailPrice}
                className="text-xs text-slate-700 border px-2 py-1 rounded disabled:opacity-50"
              >
                Recompute Retail Price
              </button>
            </div>

            <TextInput
              name="packingStock"
              label="Retail Stock"
              type="number"
              value={formData.packingStock}
              onChange={handleInput}
              error={errors.packingStock}
            />
          </FormGroupRow>
        ) : null}

        <FormGroupRow>
          <TextInput
            name="stock"
            label="Whole Stock"
            type="number"
            value={formData.stock}
            onChange={handleInput}
            error={errors.stock}
          />

          <TextInput
            name="minStock"
            label="Min Stock"
            type="number"
            value={formData.minStock}
            onChange={handleInput}
            error={errors.minStock}
          />
        </FormGroupRow>
      </FormSection>

      <FormSection
        title="Identifiers and Ops Meta"
        description="SKU/barcode and stock monitoring metadata."
        bordered
      >
        <FormGroupRow>
          <div>
            <TextInput
              name="barcode"
              label="Barcode"
              value={formData.barcode}
              onChange={handleInput}
              error={errors.barcode}
            />
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline"
              onClick={() => {
                const code = makeLocalEan13(refs.storeCode);
                setFormData((prev) => ({ ...prev, barcode: code }));
              }}
            >
              Generate barcode
            </button>
          </div>

          <TextInput
            name="sku"
            label="SKU"
            value={formData.sku}
            onChange={handleInput}
            error={errors.sku}
          />
        </FormGroupRow>

        <FormGroupRow>
          <TextInput
            name="expirationDate"
            label="Expiration Date"
            type="date"
            value={formData.expirationDate}
            onChange={handleInput}
          />

          <TextInput
            name="replenishAt"
            label="Replenish At"
            type="date"
            value={formData.replenishAt}
            onChange={handleInput}
          />
        </FormGroupRow>

        <FormGroupRow>
          <SelectInput
            label="Location"
            value={formData.locationId}
            onChange={(value) => {
              const next = String(value);
              setFormData((prev) => ({
                ...prev,
                locationId: next,
                customLocationName: next === "__custom__" ? prev.customLocationName : "",
              }));
            }}
            options={[
              { label: "-- Location --", value: "" },
              ...refs.locations.map((location) => ({
                label: location.name,
                value: String(location.id),
              })),
              { label: "Other", value: "__custom__" },
            ]}
          />
          <input type="hidden" name="locationId" value={formData.locationId} />

          {formData.locationId === "__custom__" ? (
            <TextInput
              name="customLocationNameInput"
              label="Custom Location"
              value={formData.customLocationName}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  customLocationName: event.target.value,
                }))
              }
            />
          ) : (
            <div />
          )}
        </FormGroupRow>
      </FormSection>

      <FormSection
        title="Description and Tagging"
        description="Capture usage, targets, and optional image evidence."
        bordered
      >
        <Textarea
          name="description"
          label="Description"
          rows={4}
          value={formData.description}
          onChange={handleInput}
        />

        <FormGroupRow>
          <MultiSelectInput
            name="indicationIds"
            label="Indications"
            options={refs.indications
              .filter(
                (item) =>
                  !formData.categoryId ||
                  String(item.categoryId ?? "") === String(formData.categoryId)
              )
              .map((item) => ({ label: item.name, value: String(item.id) }))}
            selected={selectedIndications}
            onChange={setSelectedIndications}
            onCustomInput={handleCustomIndication}
          />

          <MultiSelectInput
            name="targetIds"
            label="Targets"
            options={targetOptions}
            selected={selectedTargets}
            onChange={setSelectedTargets}
            onCustomInput={handleCustomTarget}
          />
        </FormGroupRow>

        <FormGroupRow>
          <TextInput
            name="imageTag"
            label="Image Tag"
            value={formData.imageTag}
            onChange={handleInput}
          />

          <div>
            <div className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Product Photos (optional, max 4)
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {PRODUCT_PHOTO_SLOTS.map((slot) => {
                const previewUrl = slotPreviewUrls[slot];
                const currentUrl = previewUrl || existingPhotoBySlot.get(slot) || null;
                return (
                  <div key={slot} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      Slot {slot}
                    </div>
                    {currentUrl ? (
                      <img
                        src={currentUrl}
                        alt={`Product slot ${slot}`}
                        className="mb-2 h-20 w-20 rounded border object-cover"
                      />
                    ) : (
                      <div className="mb-2 h-20 w-20 rounded border border-dashed text-[11px] text-slate-400 grid place-items-center">
                        Empty
                      </div>
                    )}
                    <SoTFileInput
                      id={`productPhotoFile_${slot}`}
                      name={`productPhotoFile_${slot}`}
                      accept="image/jpeg,image/png,image/webp"
                      className="block text-sm"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setSlotPreview(slot, file);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Upload up to 4 photos. Any slot can stay empty.
            </p>
          </div>
        </FormGroupRow>
      </FormSection>

      <SoTActionBar
        className="mb-0 pb-2"
        left={
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
        right={
          <Button type="submit" variant="primary" disabled={fetcher.state !== "idle"}>
            {fetcher.state !== "idle"
              ? "Saving..."
              : mode === "create"
              ? "Save Product"
              : "Update Product"}
          </Button>
        }
      />
    </fetcher.Form>
  );
}
