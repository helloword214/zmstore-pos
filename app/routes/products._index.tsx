import type { Product } from "@prisma/client";
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, Link } from "@remix-run/react";
import { db } from "~/utils/db.server";

// Loader returns typed Product array
export async function loader(): Promise<Product[]> {
  const products = await db.product.findMany();
  return products;
}

// Handle create & delete actions
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();

  // Handle delete if deleteId is sent
  const deleteId = formData.get("deleteId");
  if (deleteId) {
    await db.product.delete({
      where: { id: Number(deleteId) },
    });
    return redirect("/products");
  }

  // Handle create product
  const name = formData.get("name");
  const price = parseFloat(formData.get("price") as string);
  const unit = formData.get("unit");

  if (!name || isNaN(price) || !unit) {
    return json({ error: "All fields are required" }, { status: 400 });
  }

  await db.product.create({
    data: {
      name: name.toString(),
      price,
      unit: unit.toString(),
    },
  });

  return redirect("/products");
}

export default function ProductsPage() {
  const products = useLoaderData<Product[]>();

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">🛒 Product List</h1>

      {/* Add New Product Form */}
      <Form method="post" className="space-y-4 p-4 bg-gray-50 rounded shadow">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Product Name
          </label>
          <input
            id="name"
            type="text"
            name="name"
            required
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="price" className="block text-sm font-medium">
            Price (₱)
          </label>
          <input
            id="price"
            type="number"
            name="price"
            step="0.01"
            required
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="unit" className="block text-sm font-medium">
            Unit (e.g. kg, sack)
          </label>
          <input
            id="unit"
            type="text"
            name="unit"
            required
            className="w-full p-2 border rounded"
          />
        </div>
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          ➕ Add Product
        </button>
      </Form>

      {/* Product List */}
      <ul className="space-y-2">
        {products.map((product) => (
          <li
            key={product.id}
            className="p-4 bg-white rounded shadow flex justify-between items-center"
          >
            <div>
              <div className="font-semibold text-black">
                {product.name || "(No name)"}
              </div>
              <div className="text-sm text-gray-600">
                ₱{product.price.toFixed(2)} per {product.unit}
              </div>
            </div>

            <div className="flex gap-4 items-center">
              <Link
                to={`/products/${product.id}/edit`}
                className="text-blue-600 hover:underline"
              >
                Edit
              </Link>

              <Form
                method="post"
                onSubmit={(e) => {
                  if (
                    !confirm(
                      `Are you sure you want to delete "${product.name}"?`
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="deleteId" value={product.id} />
                <button
                  type="submit"
                  className="text-red-600 hover:underline"
                  aria-label={`Delete ${product.name}`}
                >
                  Delete
                </button>
              </Form>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
