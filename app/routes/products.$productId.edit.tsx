import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { db } from "~/utils/db.server";

// Loader to fetch product by ID
export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.productId);
  if (isNaN(id)) throw new Response("Invalid product ID", { status: 400 });

  const product = await db.product.findUnique({ where: { id } });
  if (!product) throw new Response("Product not found", { status: 404 });

  return json(product);
}

// Action to update the product
export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.productId);
  if (isNaN(id)) throw new Response("Invalid product ID", { status: 400 });

  const formData = await request.formData();
  const name = formData.get("name");
  const price = parseFloat(formData.get("price") as string);
  const unit = formData.get("unit");

  if (!name || isNaN(price) || !unit) {
    return json({ error: "All fields are required" }, { status: 400 });
  }

  await db.product.update({
    where: { id },
    data: {
      name: name.toString(),
      price,
      unit: unit.toString(),
    },
  });

  return redirect("/products");
}

// Component with form pre-filled
export default function EditProductPage() {
  const product = useLoaderData<typeof loader>();

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Edit Product</h1>
      <Form method="post" className="space-y-4">
        <div>
          <label htmlFor="name" className="block font-medium mb-1">
            Name
          </label>
          <input
            id="name"
            name="name"
            defaultValue={product.name}
            required
            className="w-full p-2 border rounded focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          />
        </div>
        <div>
          <label htmlFor="price" className="block font-medium mb-1">
            Price (₱)
          </label>
          <input
            id="price"
            name="price"
            type="number"
            step="0.01"
            defaultValue={product.price}
            required
            className="w-full p-2 border rounded focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          />
        </div>
        <div>
          <label htmlFor="unit" className="block font-medium mb-1">
            Unit
          </label>
          <input
            id="unit"
            name="unit"
            defaultValue={product.unit}
            required
            className="w-full p-2 border rounded focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          />
        </div>
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
        >
          Save Changes
        </button>
      </Form>
    </main>
  );
}
