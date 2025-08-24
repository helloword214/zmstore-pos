import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { getSession, commitSession } from "~/utils/session.server";

type CartItem = { id: number; qty: number };

const MIN_QTY = 0.25;
const MAX_QTY = 99;

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const cart: CartItem[] = session.get("cart") || [];

  const products = await db.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, price: true },
    orderBy: { name: "asc" },
    take: 100, // kiosk list cap
  });

  const rows = cart
    .map((it) => {
      const p = products.find((pp) => pp.id === it.id);
      if (!p) return null;
      const unitPrice = Number(p.price ?? 0);
      return {
        id: p.id,
        name: p.name,
        unitPrice,
        qty: Number(it.qty),
        lineTotal: Number(it.qty) * unitPrice,
      };
    })
    .filter(Boolean) as Array<{
    id: number;
    name: string;
    unitPrice: number;
    qty: number;
    lineTotal: number;
  }>;

  const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);

  // Build slip payload snapshot from current view (name + unitPrice)
  const slipItems = rows.map((r) => ({
    id: r.id,
    name: r.name,
    qty: r.qty,
    unitPrice: r.unitPrice,
  }));

  return json({ products, cart: rows, subtotal, slipItems });
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  let cart: CartItem[] = session.get("cart") || [];

  const form = await request.formData();
  const act = String(form.get("action") ?? "");
  const productId = Number(form.get("productId"));
  const qtyRaw = form.get("qty");
  const qty = qtyRaw != null ? Number(qtyRaw) : undefined;

  const clampQty = (n: number) =>
    Math.max(MIN_QTY, Math.min(MAX_QTY, Math.round(n * 100) / 100));

  if (act === "add" && productId) {
    const ex = cart.find((c) => c.id === productId);
    if (ex) ex.qty = clampQty(ex.qty + 1);
    else cart.push({ id: productId, qty: 1 });
  } else if (act === "inc" && productId) {
    const ex = cart.find((c) => c.id === productId);
    if (ex) ex.qty = clampQty(ex.qty < 1 ? ex.qty + 0.25 : ex.qty + 1);
  } else if (act === "dec" && productId) {
    const ex = cart.find((c) => c.id === productId);
    if (ex) {
      const next = ex.qty <= 1 ? ex.qty - 0.25 : ex.qty - 1;
      ex.qty = Math.round(next * 100) / 100;
      if (ex.qty < MIN_QTY) cart = cart.filter((c) => c.id !== productId);
    }
  } else if (act === "set" && productId && typeof qty === "number") {
    if (qty >= MIN_QTY && qty <= MAX_QTY) {
      const ex = cart.find((c) => c.id === productId);
      if (ex) ex.qty = clampQty(qty);
    }
  } else if (act === "remove" && productId) {
    cart = cart.filter((c) => c.id !== productId);
  } else if (act === "clear") {
    cart = [];
  } else {
    // ignore / fallback
  }

  session.set("cart", cart);
  return redirect("/kiosk", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function KioskPage() {
  const { products, cart, subtotal, slipItems } =
    useLoaderData<typeof loader>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const payload = JSON.stringify(slipItems);

  return (
    <main className="p-4 max-w-5xl mx-auto grid gap-6 md:grid-cols-2">
      {/* Products */}
      <section className="border rounded-lg p-3">
        <h2 className="font-semibold mb-2">Products</h2>
        <div className="divide-y">
          {products.map((p) => (
            <div
              key={p.id}
              className="py-2 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-gray-600">
                  {peso(Number(p.price ?? 0))}
                </div>
              </div>
              <Form method="post">
                <input type="hidden" name="productId" value={p.id} />
                <button
                  name="action"
                  value="add"
                  className="px-2 py-1 rounded bg-black text-white text-xs"
                >
                  Add
                </button>
              </Form>
            </div>
          ))}
        </div>
      </section>

      {/* Cart */}
      <section className="border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Cart</h2>
          <Form method="post">
            <button
              name="action"
              value="clear"
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
              disabled={cart.length === 0}
            >
              Clear
            </button>
          </Form>
        </div>

        {cart.length === 0 ? (
          <div className="text-sm text-gray-500">Cart is empty.</div>
        ) : (
          <>
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
              {cart.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-xs text-gray-600">
                      {it.qty} × {peso(it.unitPrice)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Form method="post">
                      <input type="hidden" name="productId" value={it.id} />
                      <button
                        name="action"
                        value="dec"
                        className="px-2 rounded bg-gray-200 text-sm"
                      >
                        −
                      </button>
                    </Form>
                    <Form method="post" className="flex items-center gap-1">
                      <input type="hidden" name="productId" value={it.id} />
                      <input
                        name="qty"
                        type="number"
                        step="0.25"
                        min={MIN_QTY}
                        max={MAX_QTY}
                        defaultValue={it.qty}
                        className="w-16 text-sm border rounded px-2 py-1"
                      />
                      <button
                        name="action"
                        value="set"
                        className="px-2 rounded bg-gray-200 text-sm"
                      >
                        ✔
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="productId" value={it.id} />
                      <button
                        name="action"
                        value="inc"
                        className="px-2 rounded bg-gray-200 text-sm"
                      >
                        +
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="productId" value={it.id} />
                      <button
                        name="action"
                        value="remove"
                        className="px-2 rounded text-red-600 text-sm"
                      >
                        🗑
                      </button>
                    </Form>
                  </div>

                  <div className="w-24 text-right font-medium">
                    {peso(it.lineTotal)}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-gray-600">Subtotal</div>
              <div className="font-semibold">{peso(subtotal)}</div>
            </div>

            <Form method="post" action="/orders.new" className="mt-3">
              <input type="hidden" name="items" value={payload} />
              <input type="hidden" name="terminalId" value="KIOSK-01" />
              <button className="w-full py-2 rounded bg-black text-white text-sm">
                Print Order Slip
              </button>
            </Form>
          </>
        )}
      </section>
    </main>
  );
}
