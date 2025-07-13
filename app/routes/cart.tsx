import React from "react";
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

const maxQuantity = 99;

export const loader: LoaderFunction = async ({ request }) => {
  const session = await getSession(request);
  const cart: CartItem[] = session.get("cart") || [];
  console.log("[Loader] Cart session:", cart);

  const products = await db.product.findMany();
  console.log("[Loader] Products from DB:", products);

  const cartWithProducts = cart
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      if (!product) return null;
      return { ...product, quantity: item.quantity };
    })
    .filter(Boolean);

  console.log("[Loader] Cart with products:", cartWithProducts);

  return json({ products, cart: cartWithProducts });
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const session = await getSession(request);

  const actionType = formData.get("action");
  const productId = Number(formData.get("productId"));

  let cart: CartItem[] = session.get("cart") || [];
  console.log("[Action] Incoming:", { actionType, productId, cart });

  if (actionType === "add") {
    const existing = cart.find((item) => item.id === productId);
    if (existing) {
      cart = cart.map((item) =>
        item.id === productId
          ? { ...item, quantity: Math.min(item.quantity + 1, maxQuantity) }
          : item
      );
    } else {
      cart = [...cart, { id: productId, quantity: 1 }];
    }
  } else if (actionType === "increment") {
    cart = cart.map((item) =>
      item.id === productId
        ? { ...item, quantity: Math.min(item.quantity + 1, maxQuantity) }
        : item
    );
  } else if (actionType === "decrement") {
    cart = cart
      .map((item) =>
        item.id === productId ? { ...item, quantity: item.quantity - 1 } : item
      )
      .filter((item) => item.quantity > 0);
  } else if (actionType === "remove") {
    cart = cart.filter((item) => item.id !== productId);
  } else if (actionType === "checkout") {
    if (cart.length === 0) {
      return json({ error: "Cart is empty" }, { status: 400 });
    }

    const products = await db.product.findMany({
      where: { id: { in: cart.map((item) => item.id) } },
    });

    const total = cart.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.id);
      return sum + (product?.price ?? 0) * item.quantity;
    }, 0);

    await db.sale.create({
      data: {
        total,
        items: {
          create: cart.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            price: products.find((p) => p.id === item.id)?.price ?? 0,
          })),
        },
      },
    });

    cart = [];
  } else {
    return json({ error: "Invalid action" }, { status: 400 });
  }

  session.set("cart", cart);

  return redirect("/cart", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
};

export default function CartPage() {
  const { products, cart } = useLoaderData<{
    products: Product[];
    cart: (Product & { quantity: number })[];
  }>();

  React.useEffect(() => {
    console.log("[UI] Products:", products);
    console.log("[UI] Cart:", cart);
  }, [products, cart]);

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-10">
      <h1 className="text-4xl font-extrabold mb-8 text-center">
        🛒 Shopping Cart
      </h1>

      {/* Products List */}
      <section>
        <h2 className="text-2xl font-semibold mb-6 border-b pb-2">Products</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {products.map((p) => (
            <li
              key={p.id}
              className="p-6 border rounded-lg flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow duration-200"
            >
              <div>
                <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
                <p className="text-gray-600 text-sm">
                  ₱{p.price.toFixed(2)} per {p.unit}
                </p>
              </div>
              <Form method="post">
                <input type="hidden" name="productId" value={p.id} />
                <button
                  type="submit"
                  name="action"
                  value="add"
                  className="mt-5 bg-blue-600 text-white px-5 py-2 rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                  aria-label={`Add ${p.name} to cart`}
                >
                  Add to Cart
                </button>
              </Form>
            </li>
          ))}
        </ul>
      </section>

      {/* Cart Items */}
      <section>
        <h2 className="text-2xl font-semibold mb-6 border-b pb-2">
          Cart Items
        </h2>
        {cart.length === 0 ? (
          <p className="text-gray-500 text-center">Your cart is empty.</p>
        ) : (
          <ul className="space-y-5">
            {cart.map((item) => {
              const isMaxed = item.quantity >= maxQuantity;
              return (
                <li
                  key={item.id}
                  className="flex justify-between items-center border p-5 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200"
                >
                  <div>
                    <div className="font-semibold text-lg">{item.name}</div>
                    <div className="text-gray-600 text-sm">
                      ₱{item.price.toFixed(2)} per {item.unit}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">
                      Quantity: {item.quantity}
                    </div>
                  </div>
                  <Form method="post" className="flex items-center gap-2">
                    <input type="hidden" name="productId" value={item.id} />

                    <button
                      type="submit"
                      name="action"
                      value="decrement"
                      className="px-3 py-1 bg-gray-300 rounded hover:bg-gray-400"
                      aria-label={`Decrease quantity of ${item.name}`}
                    >
                      -
                    </button>

                    <button
                      type="submit"
                      name="action"
                      value="increment"
                      className={`px-3 py-1 rounded text-white ${
                        isMaxed
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                      aria-label={`Increase quantity of ${item.name}`}
                      disabled={isMaxed}
                    >
                      +
                    </button>

                    <button
                      type="submit"
                      name="action"
                      value="remove"
                      className="ml-4 text-red-600 hover:text-red-800 font-semibold"
                      aria-label={`Remove ${item.name} from cart`}
                    >
                      Remove
                    </button>
                  </Form>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-8 font-bold text-2xl text-right">
          Total: ₱{total.toFixed(2)}
        </div>

        {cart.length > 0 && (
          <Form method="post" className="mt-6 text-right">
            <button
              type="submit"
              name="action"
              value="checkout"
              className="inline-block bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-400"
              aria-label="Checkout"
            >
              🛒 Checkout
            </button>
          </Form>
        )}
      </section>
    </main>
  );
}
