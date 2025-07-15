import type { Product, Category, Brand } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { db } from "~/utils/db.server";

// Type
type ProductWithDetails = Product & {
  category: Category | null;
  brand: Brand | null;
};

export async function loader() {
  const [products, categories, brands] = await Promise.all([
    db.product.findMany({ include: { category: true, brand: true } }),
    db.category.findMany(),
    db.brand.findMany(),
  ]);

  console.log("[📦 Loaded products]:", products.length);

  return json({ products, categories, brands });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  console.log("[📤 Incoming formData]:");
  for (const [key, value] of formData.entries()) {
    console.log(`  ${key}: ${value}`);
  }

  // 🗑️ DELETE logic
  if (formData.get("deleteId")) {
    const deleteId = Number(formData.get("deleteId"));
    try {
      await db.product.delete({ where: { id: deleteId } });
      console.log("✅ Product deleted:", deleteId);
      return json({ success: true, action: "deleted" });
    } catch (error) {
      console.error("❌ Delete failed", error);
      return json({ error: "Failed to delete product." }, { status: 500 });
    }
  }

  // 🧠 Extract all shared fields
  const id = formData.get("id")?.toString(); // 🆔 Edit mode check
  const name = formData.get("name")?.toString();
  const price = parseFloat(formData.get("price") as string);
  const unit = formData.get("unit")?.toString();

  if (!name || isNaN(price) || !unit) {
    console.error("[❌ Missing fields]", { name, price, unit });
    return json({ error: "Required fields missing." }, { status: 400 });
  }

  const categoryId = formData.get("categoryId")?.toString();
  const brandId = formData.get("brandId")?.toString();
  const brandName = formData.get("brandName")?.toString();
  const stock = parseFloat(formData.get("stock") as string);
  const dealerPrice = parseFloat(formData.get("dealerPrice") as string);
  const srp = parseFloat(formData.get("srp") as string);
  const packingSize = formData.get("packingSize")?.toString();
  const expirationDate = formData.get("expirationDate")?.toString();
  const replenishAt = formData.get("replenishAt")?.toString();
  const imageTag = formData.get("imageTag")?.toString();
  const imageUrl = formData.get("imageUrl")?.toString();

  console.log("[🔍 Will Save Product with]", {
    id,
    name,
    price,
    unit,
    categoryId,
    brandId,
    brandName,
    stock,
    dealerPrice,
    srp,
    packingSize,
    expirationDate,
    replenishAt,
    imageTag,
    imageUrl,
  });

  // 🧠 Resolve brand
  let resolvedBrandId: number | undefined = undefined;
  if (brandName && brandName.trim()) {
    const existing = await db.brand.findFirst({
      where: {
        name: brandName.trim(),
        categoryId: categoryId ? Number(categoryId) : undefined,
      },
    });
    resolvedBrandId = existing
      ? existing.id
      : (
          await db.brand.create({
            data: {
              name: brandName.trim(),
              categoryId: categoryId ? Number(categoryId) : undefined,
            },
          })
        ).id;
  } else if (brandId) {
    resolvedBrandId = Number(brandId);
  }

  // ✏️ UPDATE if ID exists
  if (id) {
    try {
      const updated = await db.product.update({
        where: { id: Number(id) },
        data: {
          name,
          price,
          unit,
          categoryId: categoryId ? Number(categoryId) : undefined,
          brandId: resolvedBrandId,
          stock: isNaN(stock) ? undefined : stock,
          dealerPrice: isNaN(dealerPrice) ? undefined : dealerPrice,
          srp: isNaN(srp) ? undefined : srp,
          packingSize,
          expirationDate: expirationDate ? new Date(expirationDate) : undefined,
          replenishAt: replenishAt ? new Date(replenishAt) : undefined,
          imageTag,
          imageUrl,
        },
      });
      console.log("[✏️ Product Updated]:", updated);
      return json({ success: true, action: "updated" });
    } catch (error) {
      console.error("❌ Update failed", error);
      return json({ error: "Update failed." }, { status: 500 });
    }
  }

  // ➕ CREATE if no ID
  const newProduct = await db.product.create({
    data: {
      name,
      price,
      unit,
      categoryId: categoryId ? Number(categoryId) : undefined,
      brandId: resolvedBrandId,
      stock: isNaN(stock) ? undefined : stock,
      dealerPrice: isNaN(dealerPrice) ? undefined : dealerPrice,
      srp: isNaN(srp) ? undefined : srp,
      packingSize,
      expirationDate: expirationDate ? new Date(expirationDate) : undefined,
      replenishAt: replenishAt ? new Date(replenishAt) : undefined,
      imageTag,
      imageUrl,
    },
  });

  console.log("[✅ Product Saved]:", newProduct);
  return json({ success: true, action: "created" });
}

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
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

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
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const validateStep = () => {
    const stepFields = step === 1 ? ["name", "price", "unit"] : [];
    const newErrors: Record<string, string> = {};
    stepFields.forEach((field) => {
      if (!formData[field]) newErrors[field] = "Required";
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMsg, errorMsg]);

  const filteredProducts = (products || []).filter((p) => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return true; // no search = show all

    return (
      p.name?.toLowerCase().includes(search) ||
      p.description?.toLowerCase().includes(search) ||
      p.brand?.name?.toLowerCase().includes(search)
    );
  });

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

      <div className="mt-6 overflow-auto border rounded bg-white">
        <div className="mt-4 flex items-center gap-2">
          <input
            type="text"
            placeholder="🔍 Search product name, description, brand..."
            className="w-full max-w-sm p-2 border rounded"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {!filteredProducts.length ? (
          <div className="text-gray-500 italic mt-6">
            No products available.
          </div>
        ) : (
          <div className="mt-6 overflow-auto border rounded bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="p-3 font-semibold text-orange-500">I.D</th>
                  <th className="p-3 font-semibold text-orange-500">Name</th>
                  <th className="p-3 font-semibold text-orange-500">
                    Category
                  </th>
                  <th className="p-3 font-semibold text-orange-500">Price</th>
                  <th className="p-3 font-semibold text-orange-500">
                    Packing Size
                  </th>
                  <th className="p-3 font-semibold text-orange-500">Stocks</th>
                  <th className="p-3 font-semibold text-orange-500">Target</th>
                  <th className="p-3 font-semibold  text-orange-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="border-t">
                    <td className="text-black p-3">{product.id || "—"}</td>
                    <td className="text-black p-3 font-medium">
                      {product.name}{" "}
                      {product.brand?.name ? (
                        <span className="text-gray-500">
                          ({product.brand.name})
                        </span>
                      ) : null}
                    </td>
                    <td className="text-black p-3">
                      {product.category?.name || "—"}
                    </td>
                    <td className="p-3 text-black">
                      {typeof product.price === "number" &&
                      !isNaN(product.price)
                        ? `₱${product.price.toFixed(2)} / ${product.unit}`
                        : "—"}
                    </td>
                    <td className="text-black p-3">
                      {product.packingSize || "—"}
                    </td>
                    <td className="text-black p-3">
                      {product.stock && product.packingSize && product.unit
                        ? `${product.stock} pcs – ${product.packingSize} per ${product.unit}`
                        : "—"}
                    </td>
                    <td className="text-black p-3">{product.target || "—"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(product)}
                          className="bg-yellow-400 text-white px-2 py-1 rounded text-xs"
                        >
                          ✏️ Edit
                        </button>
                        <actionFetcher.Form method="post">
                          <input
                            type="hidden"
                            name="deleteId"
                            value={product.id}
                          />
                          <button
                            type="submit"
                            className="bg-red-600 text-white px-2 py-1 rounded text-xs"
                            onClick={(e) => {
                              if (
                                !confirm(
                                  "Are you sure you want to delete this product?"
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            🗑 Delete
                          </button>
                        </actionFetcher.Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">
                    Step 1: Basic Info
                  </h3>

                  <div className="mb-4">
                    <label htmlFor="name" className="block font-medium mb-1">
                      Product Name
                    </label>
                    <input
                      name="name"
                      className={`w-full p-2 border rounded ${
                        errors.name && "border-red-500"
                      }`}
                      placeholder="Name"
                      value={formData.name || ""}
                      onChange={handleInput}
                      required
                    />
                  </div>

                  <div className="mb-4">
                    <label htmlFor="price" className="block font-medium mb-1">
                      Price
                    </label>
                    <input
                      name="price"
                      type="number"
                      className={`w-full p-2 border rounded ${
                        errors.price && "border-red-500"
                      }`}
                      placeholder="Price"
                      value={formData.price || ""}
                      onChange={handleInput}
                      required
                    />
                  </div>

                  <div className="mb-4">
                    <label htmlFor="unit" className="block font-medium mb-1">
                      Unit
                    </label>
                    <select
                      name="unit"
                      className={`w-full p-2 border rounded ${
                        errors.unit && "border-red-500"
                      }`}
                      value={formData.unit || ""}
                      onChange={handleInput}
                      required
                    >
                      <option value="">-- Unit --</option>
                      {unitOptions.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-4">
                    <label
                      htmlFor="categoryId"
                      className="block font-medium mb-1"
                    >
                      Category
                    </label>
                    <select
                      name="categoryId"
                      className="w-full p-2 border rounded"
                      value={formData.categoryId || ""}
                      onChange={handleInput}
                    >
                      <option value="">-- Category --</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-4">
                    <label htmlFor="brandId" className="block font-medium mb-1">
                      Brand
                    </label>
                    <select
                      name="brandId"
                      className="w-full p-2 border rounded"
                      value={formData.brandId || ""}
                      onChange={handleInput}
                    >
                      <option value="">-- Brand --</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-6">
                    <label
                      htmlFor="brandName"
                      className="block font-medium mb-1"
                    >
                      Or New Brand
                    </label>
                    <input
                      name="brandName"
                      className="w-full p-2 border rounded"
                      placeholder="Enter new brand..."
                      value={formData.brandName || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => validateStep() && setStep(2)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}

              {/* Step 2: Stock & Packaging */}
              {step === 2 && (
                <>
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">
                    Step 2: Stock & Packaging
                  </h3>

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

                  <div className="mb-4">
                    <label htmlFor="stock" className="block font-medium mb-1">
                      Stock
                    </label>
                    <input
                      name="stock"
                      type="number"
                      className="w-full p-2 border rounded"
                      placeholder="Stock"
                      value={formData.stock || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="mb-4">
                    <label
                      htmlFor="dealerPrice"
                      className="block font-medium mb-1"
                    >
                      Dealer Price
                    </label>
                    <input
                      name="dealerPrice"
                      type="number"
                      className="w-full p-2 border rounded"
                      placeholder="Dealer Price"
                      value={formData.dealerPrice || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="mb-4">
                    <label htmlFor="srp" className="block font-medium mb-1">
                      SRP
                    </label>
                    <input
                      name="srp"
                      type="number"
                      className="w-full p-2 border rounded"
                      placeholder="Suggested Retail Price"
                      value={formData.srp || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="mb-4">
                    <label
                      htmlFor="packingSize"
                      className="block font-medium mb-1"
                    >
                      Packing Size
                    </label>
                    <input
                      name="packingSize"
                      className="w-full p-2 border rounded"
                      placeholder="e.g. 100ml / 50kg"
                      value={formData.packingSize || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="mb-4">
                    <label
                      htmlFor="epiationDate"
                      className="block font-medium mb-1"
                    >
                      Expiration Date
                    </label>
                    <input
                      name="expirationDate"
                      type="date"
                      className="w-full p-2 border rounded"
                      value={formData.expirationDate || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="mb-6">
                    <label
                      htmlFor="replenishAt"
                      className="block font-medium mb-1"
                    >
                      Replenish At
                    </label>
                    <input
                      name="replenishAt"
                      type="date"
                      className="w-full p-2 border rounded"
                      value={formData.replenishAt || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="bg-gray-500 text-white px-4 py-2 rounded shadow"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}

              {/* Step 3: Description & Tags */}
              {step === 3 && (
                <>
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">
                    Step 3: Description & Tags
                  </h3>

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

                  <div className="mb-4">
                    <label
                      htmlFor="description"
                      className="block font-medium mb-1"
                    >
                      Description
                    </label>
                    <textarea
                      name="description"
                      placeholder="Enter description..."
                      className="w-full p-2 border rounded"
                      value={formData.description || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <fieldset className="mb-4">
                    <legend className="font-semibold mb-2">Uses</legend>
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
                          <label
                            key={use}
                            className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded text-sm"
                          >
                            <input
                              type="checkbox"
                              name="uses"
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
                            {use}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <input
                    type="hidden"
                    name="uses"
                    value={formData.uses || ""}
                  />

                  <fieldset className="mb-4">
                    <legend className="font-semibold mb-2">For (Target)</legend>
                    <div className="flex flex-wrap gap-2">
                      {targetOptions.map((t) => {
                        const selected = formData.target
                          ?.split(",")
                          .includes(t);
                        return (
                          <label
                            key={t}
                            className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded text-sm"
                          >
                            <input
                              type="checkbox"
                              name="target"
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
                            {t}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <input
                    type="hidden"
                    name="target"
                    value={formData.target || ""}
                  />

                  <div className="mb-4">
                    <label htmlFor="nameTag" className="block font-medium mb-1">
                      Image Tag
                    </label>
                    <input
                      name="imageTag"
                      className="w-full p-2 border rounded"
                      placeholder="e.g. vitamins_icon"
                      value={formData.imageTag || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="mb-6">
                    <label
                      htmlFor="imageUrl"
                      className="block font-medium mb-1"
                    >
                      Image URL
                    </label>
                    <input
                      name="imageUrl"
                      className="w-full p-2 border rounded"
                      placeholder="https://example.com/image.jpg"
                      value={formData.imageUrl || ""}
                      onChange={handleInput}
                    />
                  </div>

                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="bg-gray-500 text-white px-4 py-2 rounded shadow"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow"
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
                    </button>
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
