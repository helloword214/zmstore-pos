import type { Product, Category, Brand } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { db } from "~/utils/db.server";
import { FormSection } from "~/components/ui/FormSection";
import { FormGroupRow } from "~/components/ui/FormGroupRow";
import { TextInput } from "~/components/ui/TextInput";
import { SelectInput } from "~/components/ui/SelectInput";
import { Button } from "~/components/ui/Button";
import { Textarea } from "~/components/ui/Textarea";
import { TagCheckbox } from "~/components/ui/TagCheckbox";
import { ProductTable } from "~/components/ui/ProductTable";
import { Pagination } from "~/components/ui/Pagination";
import { CurrencyInput } from "~/components/ui/CurrencyInput";

// Type
type ProductWithDetails = Product & {
  category: Category | null;
  brand: Brand | null;
};

export async function loader() {
  const [products, categories, brands] = await Promise.all([
    db.product.findMany({
      include: { category: true, brand: true },
      orderBy: { createdAt: "desc" },
    }),
    db.category.findMany(),
    db.brand.findMany(),
  ]);

  console.log("[📦 Loaded products]:", products.length);

  return json({ products, categories, brands });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const formData = await request.formData();

    const deleteId = formData.get("deleteId")?.toString();
    if (deleteId) {
      await db.product.delete({
        where: { id: Number(deleteId) },
      });

      return json({ success: true, action: "deleted" });
    }

    const id = formData.get("id")?.toString();
    const name = formData.get("name")?.toString() || "";
    const price = parseFloat(formData.get("price")?.toString() || "0");
    const unit = formData.get("unit")?.toString() || "";

    const categoryId = formData.get("categoryId")?.toString();
    const brandId = formData.get("brandId")?.toString();
    const brandName = formData.get("brandName")?.toString();

    const stock = parseFloat(formData.get("stock")?.toString() || "0");
    const dealerPrice = parseFloat(
      formData.get("dealerPrice")?.toString() || "0"
    );
    const srp = parseFloat(formData.get("srp")?.toString() || "0");

    const packingSize = formData.get("packingSize")?.toString();
    const expirationDate = formData.get("expirationDate")?.toString();
    const replenishAt = formData.get("replenishAt")?.toString();

    const imageTag = formData.get("imageTag")?.toString();
    const imageUrl = formData.get("imageUrl")?.toString();
    const description = formData.get("description")?.toString();
    const uses =
      formData.get("uses")?.toString()?.split(",").filter(Boolean) || [];
    const target =
      formData.get("target")?.toString()?.split(",").filter(Boolean) || [];

    let resolvedBrandId: number | undefined = brandId
      ? Number(brandId)
      : undefined;

    if (!resolvedBrandId && brandName) {
      if (!categoryId) {
        return json(
          {
            success: false,
            error: "Please select a category to register the brand.",
            field: "categoryId",
          },
          { status: 400 }
        );
      }

      const normalizedBrandName = brandName.trim().toLowerCase();

      const existingBrand = await db.brand.findFirst({
        where: {
          name: {
            equals: normalizedBrandName,
            mode: "insensitive",
          },
          ...(categoryId && { categoryId: Number(categoryId) }),
        },
      });

      if (existingBrand) {
        return json(
          {
            success: false,
            error: `Brand "${brandName}" already exists. Please select it from the dropdown.`,
            field: "brandName",
          },
          { status: 400 }
        );
      }

      const newBrand = await db.brand.create({
        data: {
          name: brandName.trim(),
          ...(categoryId && {
            category: { connect: { id: Number(categoryId) } },
          }),
        },
      });

      resolvedBrandId = newBrand.id;
    }

    if (id) {
      await db.product.update({
        where: { id: Number(id) },
        data: {
          name,
          price,
          unit,
          category: categoryId
            ? { connect: { id: Number(categoryId) } }
            : undefined,
          brand: resolvedBrandId
            ? { connect: { id: resolvedBrandId } }
            : undefined,
          stock,
          dealerPrice,
          srp,
          packingSize,
          expirationDate: expirationDate ? new Date(expirationDate) : undefined,
          replenishAt: replenishAt ? new Date(replenishAt) : undefined,
          imageTag,
          imageUrl,
          description,
          uses,
          target,
        },
      });

      return json({
        success: true,
        action: "updated",
        message: "Product updated successfully.",
      });
    } else {
      await db.product.create({
        data: {
          name,
          price,
          unit,
          category: categoryId
            ? { connect: { id: Number(categoryId) } }
            : undefined,
          brand: resolvedBrandId
            ? { connect: { id: resolvedBrandId } }
            : undefined,
          stock,
          dealerPrice,
          srp,
          packingSize,
          expirationDate: expirationDate ? new Date(expirationDate) : undefined,
          replenishAt: replenishAt ? new Date(replenishAt) : undefined,
          imageTag,
          imageUrl,
          description,
          uses,
          target,
        },
      });

      return json({
        success: true,
        action: "created",
        message: "Product created successfully.",
      });
    }
  } catch (error: any) {
    console.error("[❌ Product save error]:", error);
    return json(
      {
        success: false,
        error:
          error.code === "P2002"
            ? "Duplicate entry. This product or brand already exists."
            : "Something went wrong while saving the product.",
      },
      { status: 500 }
    );
  }
};

export default function ProductsPage() {
  const loaderData = useLoaderData<{
    products: ProductWithDetails[];
    categories: Category[];
    brands: Brand[];
  }>();
  const [products, setProducts] = useState(loaderData.products);
  const [categories] = useState(loaderData.categories);
  const [brands] = useState(loaderData.brands);
  const targetOptions = [
    "Human",
    "Dog",
    "Cat",
    "Poultry",
    "Livestock",
    "Bird",
    "Plant",
    "Other",
  ];

  const [searchTerm, setSearchTerm] = useState("");
  const actionFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    action?: "created" | "updated" | "deleted";
  }>();

  const listFetcher = useFetcher<{ products: ProductWithDetails[] }>();

  useEffect(() => {
    if (listFetcher.data?.products) {
      const sorted = [...listFetcher.data.products].sort((a, b) => {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
      setProducts(sorted);
    }
  }, [listFetcher.data]);

  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Record<string, string>>({
    target: "", // ✅ ensure this is always a string
    uses: "", // ✅ same for uses
  });

  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterTarget, setFilterTarget] = useState("");
  const [filterUses, setFilterUses] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCategory, filterBrand, filterTarget, filterUses]);

  const unitOptions = [
    "vial",
    "ampule",
    "bottle",
    "ml",
    "liter",
    "sack",
    "kg",
    "g",
    "piece",
    "meter",
    "roll",
    "tank",
    "tab",
    "capsule",
  ];

  const handleOpenModal = () => {
    if (formRef.current) {
      formRef.current.reset();
    }
    setFormData({});
    setStep(1);
    setErrors({});
    setSuccessMsg("");
    setErrorMsg("");
    setShowModal(true);
  };

  const handleInput = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value } = e.target;

    const cleanedValue = ["price", "srp", "dealerPrice"].includes(name)
      ? value.replace(/[^0-9.]/g, "")
      : value;

    setFormData((prev) => ({ ...prev, [name]: cleanedValue }));
  };

  const handleEdit = (product: ProductWithDetails) => {
    setFormData({
      id: product.id?.toString() || "",
      name: product.name || "",
      price: typeof product.price === "number" ? product.price.toString() : "",
      unit: product.unit || "",
      categoryId: product.categoryId?.toString() || "",
      brandId: product.brandId?.toString() || "",
      brandName: product.brand?.name || "",
      stock: typeof product.stock === "number" ? product.stock.toString() : "",
      dealerPrice:
        typeof product.dealerPrice === "number"
          ? product.dealerPrice.toString()
          : "",
      srp: typeof product.srp === "number" ? product.srp.toString() : "",
      packingSize: product.packingSize || "",
      expirationDate: product.expirationDate
        ? new Date(product.expirationDate).toISOString().slice(0, 10)
        : "",
      replenishAt: product.replenishAt
        ? new Date(product.replenishAt).toISOString().slice(0, 10)
        : "",
      imageTag: product.imageTag || "",
      imageUrl: product.imageUrl || "",
      description: product.description || "",
      uses: product.uses?.join(",") || "",
      target: product.target?.join(",") || "",
    });

    setStep(1);
    setShowModal(true);
    setErrors({});
    setSuccessMsg("");
    setErrorMsg("");
  };

  useEffect(() => {
    const data = actionFetcher.data;

    if (!data) return;

    const { success, error, action } = data;

    if (success) {
      const msgMap = {
        created: "✅ Product successfully saved.",
        updated: "✏️ Product successfully updated.",
        deleted: "🗑️ Product deleted successfully.",
      };

      setSuccessMsg(msgMap[action || "created"] || "✅ Operation completed.");
      setErrorMsg("");

      setTimeout(() => {
        setShowModal(false);
        setFormData({});
        setStep(1);
        setErrors({});
        if (formRef.current) formRef.current.reset();
      }, 300);

      listFetcher.load("/products/api");
      actionFetcher.data = undefined;
    }

    if (error) {
      setErrorMsg(error);
      setSuccessMsg("");
      setSearchTerm(""); // clear search so fresh product list shows
      setTimeout(() => {
        actionFetcher.data = undefined;
      }, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFetcher.data, listFetcher]);

  useEffect(() => {
    if (successMsg || errorMsg) {
      const timer = setTimeout(() => {
        setSuccessMsg("");
        setErrorMsg("");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [successMsg, errorMsg]);

  const filteredProducts = (products || []).filter((p) => {
    const search = searchTerm.trim().toLowerCase();

    const matchesSearch =
      !search ||
      p.name?.toLowerCase().includes(search) ||
      p.description?.toLowerCase().includes(search) ||
      p.brand?.name?.toLowerCase().includes(search);

    const matchesCategory =
      !filterCategory || p.categoryId?.toString() === filterCategory;

    const matchesBrand = !filterBrand || p.brandId?.toString() === filterBrand;

    const matchesTarget = !filterTarget || p.target?.includes(filterTarget);

    const matchesUses =
      filterUses.length === 0 ||
      (p.uses && filterUses.every((u) => p.uses.includes(u)));

    return (
      matchesSearch &&
      matchesCategory &&
      matchesBrand &&
      matchesTarget &&
      matchesUses
    );
  });

  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🛒 Product List</h1>
        <button
          onClick={handleOpenModal}
          className="flex round items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          ➕ Add Product
        </button>
      </div>

      {successMsg && (
        <div className="mt-4 p-3 bg-green-100 text-green-700 rounded">
          ✅ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
          ❌ {errorMsg}
        </div>
      )}

      <div className="mt-6 overflow-auto border rounded bg-white p-7">
        <div className="mt-6 border rounded-xl bg-white p-4 shadow-sm mb-7">
          {/* Search Input */}
          <div className="mb-4">
            <label
              htmlFor="Search"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Search
            </label>
            <TextInput
              placeholder="🔍 Search product name, description, brand..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full max-w-md"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Category */}
            <div>
              <label
                htmlFor="category"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Category
              </label>
              <SelectInput
                value={filterCategory}
                onChange={(e) => {
                  setFilterCategory(e.target.value);
                  setFilterBrand("");
                }}
                options={[
                  { label: "All Categories", value: "" },
                  ...categories.map((c) => ({
                    label: c.name,
                    value: c.id,
                  })),
                ]}
              />
            </div>

            {/* Brand */}
            <div>
              <label
                htmlFor="brand"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Brand
              </label>
              <SelectInput
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                options={[
                  { label: "All Brands", value: "" },
                  ...brands
                    .filter(
                      (b) =>
                        !filterCategory ||
                        b.categoryId?.toString() === filterCategory
                    )
                    .map((b) => ({
                      label: b.name,
                      value: b.id,
                    })),
                ]}
              />
            </div>

            {/* Target */}
            <div>
              <label
                htmlFor="target"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Target
              </label>
              <SelectInput
                value={filterTarget}
                onChange={(e) => setFilterTarget(e.target.value)}
                options={[
                  { label: "All Targets", value: "" },
                  ...targetOptions.map((t) => ({
                    label: t,
                    value: t,
                  })),
                ]}
              />
            </div>
          </div>

          {/* Uses Tags */}
          <FormSection title="Uses" bordered>
            <div className="flex flex-wrap gap-2">
              {[
                "Vitamins",
                "Pain Relief",
                "Antibiotic",
                "Dewormer",
                "Supplement",
              ].map((use) => (
                <TagCheckbox
                  key={use}
                  label={use}
                  value={use}
                  checked={filterUses.includes(use)}
                  onChange={(e) => {
                    const updated = e.target.checked
                      ? [...filterUses, use]
                      : filterUses.filter((u) => u !== use);
                    setFilterUses(updated);
                  }}
                />
              ))}
            </div>
          </FormSection>
        </div>

        {!paginatedProducts.length ? (
          <div className="text-gray-500 italic mt-6">
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
          />
        )}
        <Pagination
          currentPage={currentPage}
          totalItems={filteredProducts.length}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />

        <SelectInput
          label="Items per page"
          value={itemsPerPage}
          onChange={(e) => {
            setItemsPerPage(Number(e.target.value));
            setCurrentPage(1); // Optional reset
          }}
          options={[10, 20, 50].map((n) => ({ label: `${n}`, value: n }))}
          className="max-w-[180px]"
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg relative">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-2 right-3 text-xl text-gray-600"
            >
              ×
            </button>

            <actionFetcher.Form
              method="post"
              ref={formRef}
              className="space-y-4"
              onSubmit={(e) => {
                console.log("[📤 FORM SUBMIT TRIGGERED]");
                if (!confirm("Are you sure you want to save this product?")) {
                  e.preventDefault(); // cancel submission
                }
              }}
            >
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-semibold">
                  {step === 1
                    ? "Step 1: Basic Info"
                    : step === 2
                    ? "Step 2: Stock & Packaging"
                    : "Step 3: Description & Tags"}
                </h2>
                <span className="text-sm text-gray-500">Step {step} of 3</span>
              </div>

              {/* Step 1: Basic Info */}
              {step === 1 && (
                <>
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

                      <CurrencyInput
                        name="price"
                        label="Price"
                        placeholder="Price"
                        value={formData.price || ""}
                        onChange={handleInput}
                        error={errors.price}
                      />
                    </FormGroupRow>

                    <FormGroupRow>
                      <SelectInput
                        name="unit"
                        label="Unit"
                        value={formData.unit || ""}
                        onChange={handleInput}
                        options={[
                          { label: "-- Unit --", value: "" },
                          ...unitOptions.map((u) => ({ label: u, value: u })),
                        ]}
                        error={errors.unit}
                      />
                      <SelectInput
                        name="categoryId"
                        label="Category"
                        value={formData.categoryId || ""}
                        onChange={handleInput}
                        options={[
                          { label: "-- Category --", value: "" },
                          ...categories.map((c) => ({
                            label: c.name,
                            value: c.id,
                          })),
                        ]}
                      />
                    </FormGroupRow>

                    <FormGroupRow>
                      <SelectInput
                        name="brandId"
                        label="Brand"
                        value={formData.brandId || ""}
                        onChange={handleInput}
                        options={[
                          { label: "-- Brand --", value: "" },
                          ...brands.map((b) => ({
                            label: b.name,
                            value: b.id,
                          })),
                        ]}
                      />
                      <TextInput
                        name="brandName"
                        label="Or New Brand"
                        placeholder="Enter new brand..."
                        value={formData.brandName || ""}
                        onChange={handleInput}
                      />
                    </FormGroupRow>
                  </FormSection>

                  <div className="text-right">
                    <Button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();

                        // ✅ Validation
                        const requiredFields = ["name", "price", "unit"];
                        const newErrors: Record<string, string> = {};

                        requiredFields.forEach((field) => {
                          if (!formData[field]?.trim()) {
                            newErrors[field] = `${
                              field[0].toUpperCase() + field.slice(1)
                            } is required`;
                          }
                        });

                        setErrors(newErrors);
                        if (Object.keys(newErrors).length > 0) return;

                        const brandName = formData.brandName?.trim();
                        const categoryId = formData.categoryId;

                        if (formData.brandId) {
                          setErrorMsg("");
                          setStep(2);
                          return;
                        }

                        if (brandName) {
                          const checkData = new FormData();
                          checkData.append("brandName", brandName);
                          if (categoryId)
                            checkData.append("categoryId", categoryId);

                          try {
                            const res = await fetch("/brand/check", {
                              method: "POST",
                              body: checkData,
                            });

                            const result = await res.json();
                            console.log("[🔎 Brand Check Result]:", result);

                            if (result.exists) {
                              setErrorMsg(
                                `Brand "${brandName}" already exists in this category.`
                              );
                              return;
                            }

                            setErrorMsg("");
                            setStep(2);
                          } catch (err) {
                            console.error("[❌ Brand Check Error]:", err);
                            setErrorMsg(
                              "Could not verify brand. Please try again."
                            );
                          }
                        } else {
                          setErrorMsg(
                            "Please select a brand or enter a new one."
                          );
                        }
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </>
              )}

              {/* Step 2: Stock & Packaging */}
              {step === 2 && (
                <>
                  <FormSection
                    title="Step 2: Stock & Packaging"
                    description="Enter quantity, pricing, and packaging information."
                    bordered
                  >
                    {/* Hidden fields to preserve step 1 data */}
                    <input type="hidden" name="id" value={formData.id || ""} />
                    {[
                      "name",
                      "price",
                      "unit",
                      "categoryId",
                      "brandId",
                      "brandName",
                    ].map((key) => (
                      <input
                        key={key}
                        type="hidden"
                        name={key}
                        value={formData[key] || ""}
                      />
                    ))}

                    <FormGroupRow>
                      <TextInput
                        name="stock"
                        label="Stock"
                        type="number"
                        placeholder="Stock"
                        value={formData.stock || ""}
                        onChange={handleInput}
                      />

                      <CurrencyInput
                        name="dealerPrice"
                        label="Dealer Price"
                        placeholder="Dealer Price"
                        value={formData.dealerPrice || ""}
                        onChange={handleInput}
                      />
                    </FormGroupRow>

                    <FormGroupRow>
                      <CurrencyInput
                        name="srp"
                        label="SRP"
                        placeholder="Suggested Retail Price"
                        value={formData.srp || ""}
                        onChange={handleInput}
                      />

                      <TextInput
                        name="packingSize"
                        label="Packing Size"
                        placeholder="e.g. 100ml / 50kg"
                        value={formData.packingSize || ""}
                        onChange={handleInput}
                      />
                    </FormGroupRow>

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
                  </FormSection>

                  <div className="flex justify-between mt-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep(1)}
                    >
                      ← Back
                    </Button>
                    <Button type="button" onClick={() => setStep(3)}>
                      Next →
                    </Button>
                  </div>
                </>
              )}

              {/* Step 3: Description & Tags */}
              {step === 3 && (
                <>
                  <FormSection
                    title="Step 3: Description & Tags"
                    description="Write a product description, select applicable uses and targets, and upload an image."
                    bordered
                  >
                    {/* Hidden fields to preserve Step 1 & 2 values */}
                    {[
                      "id",
                      "name",
                      "price",
                      "unit",
                      "categoryId",
                      "brandId",
                      "brandName",
                      "stock",
                      "dealerPrice",
                      "srp",
                      "packingSize",
                      "expirationDate",
                      "replenishAt",
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
                      placeholder="Enter description..."
                      value={formData.description || ""}
                      onChange={handleInput}
                    />

                    {/* Uses tags */}
                    <FormSection title="Uses">
                      <div className="flex flex-wrap gap-2">
                        {[
                          "Vitamins",
                          "Pain Relief",
                          "Antibiotic",
                          "Dewormer",
                          "Supplement",
                        ].map((use) => {
                          const selected = formData.uses
                            ?.split(",")
                            .includes(use);
                          return (
                            <TagCheckbox
                              key={use}
                              label={use}
                              value={use}
                              checked={selected}
                              onChange={(e) => {
                                const current = formData.uses?.split(",") || [];
                                const updated = e.target.checked
                                  ? [...current, use]
                                  : current.filter((val) => val !== use);
                                setFormData({
                                  ...formData,
                                  uses: updated.join(","),
                                });
                              }}
                            />
                          );
                        })}
                      </div>
                    </FormSection>
                    <input
                      type="hidden"
                      name="uses"
                      value={formData.uses || ""}
                    />

                    {/* Target tags */}
                    <FormSection title="Target">
                      <div className="flex flex-wrap gap-2">
                        {targetOptions.map((t) => {
                          const selected = formData.target
                            ?.split(",")
                            .includes(t);
                          return (
                            <TagCheckbox
                              key={t}
                              label={t}
                              value={t}
                              checked={selected}
                              onChange={(e) => {
                                const current =
                                  formData.target?.split(",") || [];
                                const updated = e.target.checked
                                  ? [...current, t]
                                  : current.filter((val) => val !== t);
                                setFormData({
                                  ...formData,
                                  target: updated.join(","),
                                });
                              }}
                            />
                          );
                        })}
                      </div>
                    </FormSection>
                    <input
                      type="hidden"
                      name="target"
                      value={formData.target || ""}
                    />

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
                  </FormSection>

                  <div className="flex justify-between mt-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep(2)}
                    >
                      ← Back
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      onClick={(e) => {
                        if (
                          formData.id &&
                          !confirm(
                            "Are you sure you want to update this product?"
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </>
              )}
            </actionFetcher.Form>
          </div>
        </div>
      )}
    </main>
  );
}
