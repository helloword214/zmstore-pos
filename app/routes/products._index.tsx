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
      return json({ success: true });
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
  const originalPrice = parseFloat(formData.get("originalPrice") as string);
  const marketPrice = parseFloat(formData.get("marketPrice") as string);
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
    originalPrice,
    marketPrice,
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
          originalPrice: isNaN(originalPrice) ? undefined : originalPrice,
          marketPrice: isNaN(marketPrice) ? undefined : marketPrice,
          packingSize,
          expirationDate: expirationDate ? new Date(expirationDate) : undefined,
          replenishAt: replenishAt ? new Date(replenishAt) : undefined,
          imageTag,
          imageUrl,
        },
      });
      console.log("[✏️ Product Updated]:", updated);
      return json({ success: true });
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
      originalPrice: isNaN(originalPrice) ? undefined : originalPrice,
      marketPrice: isNaN(marketPrice) ? undefined : marketPrice,
      packingSize,
      expirationDate: expirationDate ? new Date(expirationDate) : undefined,
      replenishAt: replenishAt ? new Date(replenishAt) : undefined,
      imageTag,
      imageUrl,
    },
  });

  console.log("[✅ Product Saved]:", newProduct);
  return json({ success: true });
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

  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
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

  const handleInput = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
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
      name: product.name,
      price: product.price.toString(),
      unit: product.unit,
      categoryId: product.categoryId?.toString() || "",
      brandId: product.brandId?.toString() || "",
      brandName: product.brand?.name || "",
      stock: product.stock?.toString() || "",
      originalPrice: product.originalPrice?.toString() || "",
      marketPrice: product.marketPrice?.toString() || "",
      packingSize: product.packingSize || "",
      expirationDate: product.expirationDate
        ? product.expirationDate.toISOString().slice(0, 10)
        : "",
      replenishAt: product.replenishAt
        ? new Date(product.replenishAt).toISOString().slice(0, 10)
        : "",
      imageTag: product.imageTag || "",
      imageUrl: product.imageUrl || "",
      id: product.id.toString(), // You'll use this to detect update
    });
    setStep(1);
    setShowModal(true);
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      setSuccessMsg("Product successfully added.");
      setFormData({});
      setShowModal(false);

      // 🔁 Fetch updated products from loader
      fetch("/products")
        .then((res) => res.json())
        .then((data) => setProducts(data.products));
    }
  }, [fetcher.data]);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🛒 Product List</h1>
        <button
          onClick={() => {
            setShowModal(true);
            setStep(1);
            setSuccessMsg("");
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          ➕ Add Product
        </button>
      </div>

      {successMsg && (
        <div className="mt-4 p-3 bg-green-100 text-green-700 rounded">
          ✅ {successMsg}
        </div>
      )}

      <div className="mt-6 overflow-auto border rounded bg-white">
        {!products.length ? (
          <div className="text-gray-500 italic mt-6">
            No products available.
          </div>
        ) : (
          <div className="mt-6 overflow-auto border rounded bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="p-3 font-semibold text-orange-500">
                    Category
                  </th>
                  <th className="p-3 font-semibold text-orange-500">Name</th>
                  <th className="p-3 font-semibold text-orange-500">Price</th>
                  <th className="p-3 font-semibold text-orange-500">
                    Packing Size
                  </th>
                  <th className="p-3 font-semibold text-orange-500">Stocks</th>
                  <th className="p-3 font-semibold  text-orange-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-t">
                    <td className="text-black p-3">
                      {product.category?.name || "—"}
                    </td>
                    <td className="text-black p-3 font-medium">
                      {product.name}{" "}
                      {product.brand?.name ? (
                        <span className="text-gray-500">
                          ({product.brand.name})
                        </span>
                      ) : null}
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
                    <td className="p-3 space-x-2">
                      <button
                        onClick={() => handleEdit(product)}
                        className="bg-yellow-400 text-white px-2 py-1 rounded text-xs"
                      >
                        ✏️ Edit
                      </button>
                      <fetcher.Form method="post">
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
                      </fetcher.Form>
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

            <fetcher.Form
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
                  {step === 1 ? "Step 1: Basic Info" : "Step 2: Extra Info"}
                </h2>
                <span className="text-sm text-gray-500">Step {step} of 2</span>
              </div>

              {step === 1 && (
                <>
                  <input
                    name="name"
                    placeholder="Name"
                    className={`w-full p-2 border rounded ${
                      errors.name && "border-red-500"
                    }`}
                    value={formData.name || ""}
                    onChange={handleInput}
                    required
                  />
                  <input
                    name="price"
                    type="number"
                    placeholder="Price"
                    className={`w-full p-2 border rounded ${
                      errors.price && "border-red-500"
                    }`}
                    value={formData.price || ""}
                    onChange={handleInput}
                    required
                  />
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
                  <input
                    name="brandName"
                    placeholder="Or new brand..."
                    className="w-full p-2 border rounded"
                    value={formData.brandName || ""}
                    onChange={handleInput}
                  />
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => validateStep() && setStep(2)}
                      className="bg-blue-600 text-white px-4 py-2 rounded"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  {/* ✅ Hidden fields to preserve Step 1 values */}
                  <input
                    type="hidden"
                    name="name"
                    value={formData.name || ""}
                  />
                  <input
                    type="hidden"
                    name="price"
                    value={formData.price || ""}
                  />
                  <input
                    type="hidden"
                    name="unit"
                    value={formData.unit || ""}
                  />
                  <input
                    type="hidden"
                    name="categoryId"
                    value={formData.categoryId || ""}
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

                  {/* Step 2 visible fields */}
                  <input
                    name="stock"
                    type="number"
                    placeholder="Stock"
                    className="w-full p-2 border rounded"
                    value={formData.stock || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="originalPrice"
                    type="number"
                    placeholder="Original Price"
                    className="w-full p-2 border rounded"
                    value={formData.originalPrice || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="marketPrice"
                    type="number"
                    placeholder="Market Price"
                    className="w-full p-2 border rounded"
                    value={formData.marketPrice || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="packingSize"
                    placeholder="Packing Size"
                    className="w-full p-2 border rounded"
                    value={formData.packingSize || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="expirationDate"
                    type="date"
                    className="w-full p-2 border rounded"
                    value={formData.expirationDate || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="replenishAt"
                    type="date"
                    className="w-full p-2 border rounded"
                    value={formData.replenishAt || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="imageTag"
                    placeholder="Image Tag"
                    className="w-full p-2 border rounded"
                    value={formData.imageTag || ""}
                    onChange={handleInput}
                  />
                  <input
                    name="imageUrl"
                    placeholder="Image URL"
                    className="w-full p-2 border rounded"
                    value={formData.imageUrl || ""}
                    onChange={handleInput}
                  />
                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="bg-gray-400 text-white px-4 py-2 rounded"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="bg-green-600 text-white px-4 py-2 rounded"
                      onClick={(e) => {
                        console.log("[🧪 SUBMIT CLICKED]");
                        if (
                          !confirm(
                            "Are you sure you want to save this product?"
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
            </fetcher.Form>
          </div>
        </div>
      )}
    </main>
  );
}
