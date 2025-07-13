import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";

// Load all products from database
export async function loader(_: LoaderFunctionArgs) {
  const products = await db.product.findMany();
  return json(products);
}

// Handle form submission
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
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

// Render page
export default function ProductsPage() {
  const products = useLoaderData<typeof loader>();

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
          <li key={product.id} className="p-4 bg-white rounded shadow">
            <div className="font-semibold">{product.name}</div>
            <div className="text-sm text-gray-600">
              ₱{product.price.toFixed(2)} per {product.unit}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
