import type { Product } from "@prisma/client";
import {
  json,
  type LoaderFunction,
  type ActionFunction,
  redirect,
} from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { getSession, commitSession } from "~/utils/session.server";

type CartItem = { id: number; quantity: number };

// Load products and cart from session
export const loader: LoaderFunction = async ({ request }) => {
  const session = await getSession(request);
  const cart: CartItem[] = session.get("cart") || [];
  const products = await db.product.findMany();

  // Merge product info with cart items
  const cartWithProducts = cart
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      return product ? { ...product, quantity: item.quantity } : null;
    })
    .filter(Boolean);

  return json({ products, cart: cartWithProducts });
};

// Handle add/update/remove cart items
export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const session = await getSession(request);

  const actionType = formData.get("action");
  const productId = Number(formData.get("productId"));
  const quantity = Number(formData.get("quantity"));

  if (!productId || isNaN(productId)) {
    return json({ error: "Invalid product id" }, { status: 400 });
  }

  let cart: CartItem[] = session.get("cart") || [];

  if (actionType === "add") {
    const existing = cart.find((item) => item.id === productId);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ id: productId, quantity: 1 });
    }
  } else if (actionType === "update") {
    if (quantity < 1) {
      cart = cart.filter((item) => item.id !== productId);
    } else {
      cart = cart.map((item) =>
        item.id === productId ? { ...item, quantity } : item
      );
    }
  } else if (actionType === "remove") {
    cart = cart.filter((item) => item.id !== productId);
  }

  session.set("cart", cart);

  return redirect("/cart", {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
};

export default function CartPage() {
  const { products, cart } = useLoaderData<{
    products: Product[];
    cart: (Product & { quantity: number })[];
  }>();

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold mb-4">🛒 Shopping Cart</h1>

      <section>
        <h2 className="text-xl font-semibold mb-2">Products</h2>
        <Form method="post">
          <ul className="grid grid-cols-2 gap-4">
            {products.map((p) => (
              <li
                key={p.id}
                className="p-4 border rounded flex flex-col justify-between"
              >
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p>
                    ₱{p.price.toFixed(2)} per {p.unit}
                  </p>
                </div>
                <button
                  type="submit"
                  name="action"
                  value="add"
                  className="mt-4 bg-blue-600 text-white px-3 py-1 rounded"
                >
                  Add to Cart
                </button>
                <input type="hidden" name="productId" value={p.id} />
              </li>
            ))}
          </ul>
        </Form>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">Cart Items</h2>
        {cart.length === 0 ? (
          <p>Your cart is empty.</p>
        ) : (
          <ul className="space-y-3">
            {cart.map((item) => (
              <li
                key={item.id}
                className="flex justify-between items-center border p-3 rounded"
              >
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div>
                    ₱{item.price.toFixed(2)} per {item.unit}
                  </div>
                </div>
                <Form method="post" className="flex items-center gap-2">
                  <input type="hidden" name="productId" value={item.id} />
                  <input
                    type="number"
                    min={1}
                    name="quantity"
                    defaultValue={item.quantity}
                    className="w-16 p-1 border rounded"
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  />
                  <button
                    type="submit"
                    name="action"
                    value="update"
                    className="text-blue-600 hover:underline"
                  >
                    Update
                  </button>
                  <button
                    type="submit"
                    name="action"
                    value="remove"
                    className="text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 font-bold text-lg">Total: ₱{total.toFixed(2)}</div>
      </section>
    </main>
  );
}
