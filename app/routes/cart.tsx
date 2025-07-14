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

type CartItem = { id: number; quantity: number; discount?: number };

const maxQuantity = 99;
const minQuantity = 0.25;

export const loader: LoaderFunction = async ({ request }) => {
  const session = await getSession(request);
  const cart: CartItem[] = session.get("cart") || [];

  const products = await db.product.findMany();

  const cartWithProducts = cart
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      if (!product) return null;
      return {
        ...product,
        quantity: item.quantity,
        discount: item.discount || 0,
      };
    })
    .filter(Boolean);

  return json({ products, cart: cartWithProducts });
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const session = await getSession(request);

  const actionType = formData.get("action");
  const productId = Number(formData.get("productId"));
  const quantityRaw = formData.get("quantity");
  const discountRaw = formData.get("discount");
  const quantity = quantityRaw ? Number(quantityRaw) : undefined;
  const discount = discountRaw ? Number(discountRaw) : undefined;

  let cart: CartItem[] = session.get("cart") || [];

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
    cart = cart.map((item) => {
      if (item.id !== productId) return item;
      const newQuantity =
        item.quantity < 1
          ? Math.min(item.quantity + 0.25, 1)
          : Math.min(item.quantity + 1, maxQuantity);
      return { ...item, quantity: newQuantity };
    });
  } else if (actionType === "decrement") {
    cart = cart
      .map((item) => {
        if (item.id !== productId) return item;
        const newQuantity =
          item.quantity <= 1 ? item.quantity - 0.25 : item.quantity - 1;
        return { ...item, quantity: newQuantity };
      })
      .filter((item) => item.quantity >= minQuantity);
  } else if (actionType === "remove") {
    cart = cart.filter((item) => item.id !== productId);
  } else if (actionType === "update") {
    if (
      quantity === undefined ||
      quantity < minQuantity ||
      quantity > maxQuantity
    ) {
      return json({ error: "Invalid quantity" }, { status: 400 });
    }
    cart = cart.map((item) =>
      item.id === productId ? { ...item, quantity } : item
    );
  } else if (actionType === "set-discount") {
    if (discount === undefined || discount < 0) {
      return json({ error: "Invalid discount" }, { status: 400 });
    }
    cart = cart.map((item) =>
      item.id === productId ? { ...item, discount } : item
    );
  } else if (actionType === "checkout") {
    if (cart.length === 0) {
      return json({ error: "Cart is empty" }, { status: 400 });
    }

    const products = await db.product.findMany({
      where: { id: { in: cart.map((item) => item.id) } },
    });

    const total = cart.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.id);
      const price = (product?.price ?? 0) - (item.discount ?? 0);
      return sum + price * item.quantity;
    }, 0);

    await db.sale.create({
      data: {
        total,
        items: {
          create: cart.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            price:
              (products.find((p) => p.id === item.id)?.price ?? 0) -
              (item.discount ?? 0),
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
    cart: (Product & { quantity: number; discount?: number })[];
  }>();

  const total = cart.reduce(
    (sum, item) => sum + (item.price - (item.discount || 0)) * item.quantity,
    0
  );

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-10">
      <h1 className="text-4xl font-extrabold mb-8 text-center">🧾 POS Cart</h1>

      {/* Product List */}
      <section>
        <h2 className="text-2xl font-semibold mb-4 border-b pb-2">Products</h2>
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2 border">Name</th>
              <th className="p-2 border">Price</th>
              <th className="p-2 border">Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="p-2 border">{p.name}</td>
                <td className="p-2 border">
                  ₱{p.price.toFixed(2)} / {p.unit}
                </td>
                <td className="p-2 border">
                  <Form method="post">
                    <input type="hidden" name="productId" value={p.id} />
                    <button
                      type="submit"
                      name="action"
                      value="add"
                      className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm"
                    >
                      Add
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Cart Items */}
      <section>
        <h2 className="text-2xl font-semibold mb-4 border-b pb-2">Cart</h2>
        {cart.length === 0 ? (
          <p className="text-gray-500 text-center">Your cart is empty.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2 border">Qty</th>
                  <th className="p-2 border">Item</th>
                  <th className="p-2 border">Price</th>
                  <th className="p-2 border">Disc</th>
                  <th className="p-2 border">Total</th>
                  <th className="p-2 border">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => {
                  const discounted =
                    (item.price - (item.discount || 0)) * item.quantity;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="p-2 border">{item.quantity.toFixed(2)}</td>
                      <td className="p-2 border">{item.name}</td>
                      <td className="p-2 border">₱{item.price.toFixed(2)}</td>
                      <td className="p-2 border">
                        ₱{(item.discount || 0).toFixed(2)}
                        <Form method="post" className="mt-1">
                          <input
                            type="hidden"
                            name="productId"
                            value={item.id}
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name="discount"
                            defaultValue={item.discount || ""}
                            className="w-20 text-xs border px-1 py-0.5 rounded mt-1"
                          />
                          <button
                            type="submit"
                            name="action"
                            value="set-discount"
                            className="mt-1 text-blue-600 text-xs hover:underline"
                          >
                            Set
                          </button>
                        </Form>
                      </td>
                      <td className="p-2 border font-semibold">
                        ₱{discounted.toFixed(2)}
                      </td>
                      <td className="p-2 border">
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-2">
                            <Form method="post">
                              <input
                                type="hidden"
                                name="productId"
                                value={item.id}
                              />
                              <button
                                type="submit"
                                name="action"
                                value="decrement"
                                className="px-2 bg-gray-300 hover:bg-gray-400 rounded text-sm"
                                disabled={item.quantity <= 0.25}
                              >
                                -
                              </button>
                            </Form>
                            <Form method="post">
                              <input
                                type="hidden"
                                name="productId"
                                value={item.id}
                              />
                              <button
                                type="submit"
                                name="action"
                                value="increment"
                                className="px-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                                disabled={item.quantity >= maxQuantity}
                              >
                                +
                              </button>
                            </Form>
                            <Form method="post">
                              <input
                                type="hidden"
                                name="productId"
                                value={item.id}
                              />
                              <button
                                type="submit"
                                name="action"
                                value="remove"
                                className="px-2 text-red-600 hover:text-red-800 text-sm"
                              >
                                🗑
                              </button>
                            </Form>
                          </div>

                          {/* Fraction buttons */}
                          <div className="flex gap-1 mt-1">
                            {[0, 0.25, 0.5, 0.75].map((f) => {
                              const whole = Math.floor(item.quantity);
                              const newQty = +(whole + f).toFixed(2);
                              return (
                                <Form method="post" key={f}>
                                  <input
                                    type="hidden"
                                    name="productId"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="quantity"
                                    value={newQty}
                                  />
                                  <button
                                    type="submit"
                                    name="action"
                                    value="update"
                                    className={`px-2 py-0.5 text-xs border rounded ${
                                      item.quantity === newQty
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 hover:bg-gray-200"
                                    }`}
                                  >
                                    {f === 0 ? "0" : `+${f}`}
                                  </button>
                                </Form>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-6 text-right text-xl font-semibold">
              Total: ₱{total.toFixed(2)}
            </div>

            <Form method="post" className="mt-4 text-right">
              <button
                type="submit"
                name="action"
                value="checkout"
                className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
              >
                🛒 Checkout
              </button>
            </Form>
          </div>
        )}
      </section>
    </main>
  );
}
