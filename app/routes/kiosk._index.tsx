import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

export const loader: LoaderFunction = async () => {
  const [categories, products] = await Promise.all([
    db.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
        srp: true,
        allowPackSale: true,
        packingStock: true,
        packingSize: true,
        stock: true,
        minStock: true,
        categoryId: true,
        brand: { select: { id: true, name: true } },
        imageUrl: true,
        unit: { select: { name: true } }, // RetailUnit
        packingUnit: { select: { name: true } }, // PackingUnit
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);
  return json({ categories, products });
};

type L = typeof loader;
type ProductRow = ReturnType<L extends any ? L : never> extends Promise<infer T>
  ? T extends { json(): any }
    ? never
    : never
  : never; // (ignore; we’ll type inline below)

export default function KioskPage() {
  const { categories, products } = useLoaderData<typeof loader>();

  // UI state
  const [q, setQ] = React.useState("");
  const [activeCat, setActiveCat] = React.useState<number | "">("");
  const [activeBrand, setActiveBrand] = React.useState<number | "">("");

  // cart: id -> item snapshot
  const [cart, setCart] = React.useState<
    Record<
      number,
      { id: number; name: string; unitPrice: number; qty: number; step: number }
    >
  >({});

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat !== "" && p.categoryId !== activeCat) return false;
      if (activeBrand !== "" && (p.brand?.id ?? "") !== activeBrand)
        return false;
      if (!term) return true;
      return p.name.toLowerCase().includes(term);
    });
  }, [products, q, activeCat, activeBrand]);

  // derive brand options from current category (or all when no category)
  const brandOptions = React.useMemo(() => {
    const pool =
      activeCat === ""
        ? products
        : products.filter((p) => p.categoryId === activeCat);
    const map = new Map<number, string>();
    for (const p of pool) {
      if (p.brand?.id && p.brand?.name) map.set(p.brand.id, p.brand.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [products, activeCat]);

  const add = (p: (typeof products)[number]) => {
    const price = getUnitPrice(p);
    if (price === null) return; // no price set
    const step = p.allowPackSale ? 0.25 : 1;
    setCart((prev) => {
      const ex = prev[p.id];
      const nextQty = +(ex ? ex.qty + step : step).toFixed(2);
      return {
        ...prev,
        [p.id]: {
          id: p.id,
          name: p.name,
          unitPrice: price,
          qty: nextQty,
          step,
        },
      };
    });
  };

  const inc = (id: number) =>
    setCart((prev) => {
      const ex = prev[id];
      if (!ex) return prev;
      return { ...prev, [id]: { ...ex, qty: +(ex.qty + ex.step).toFixed(2) } };
    });

  const dec = (id: number) =>
    setCart((prev) => {
      const ex = prev[id];
      if (!ex) return prev;
      const next = +(ex.qty - ex.step).toFixed(2);
      const copy = { ...prev };
      if (next <= 0) delete copy[id];
      else copy[id] = { ...ex, qty: next };
      return copy;
    });

  const setQty = (id: number, qty: number) =>
    setCart((prev) => {
      const ex = prev[id];
      if (!ex) return prev;
      const clamped = Math.max(
        ex.step,
        Math.min(99, Math.round(qty * 100) / 100)
      );
      return { ...prev, [id]: { ...ex, qty: clamped } };
    });

  const items = Object.values(cart);
  const subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const payload = JSON.stringify(
    items.map(({ id, name, qty, unitPrice }) => ({ id, name, qty, unitPrice }))
  );

  const [clock, setClock] = React.useState(() =>
    new Date().toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  );
  React.useEffect(() => {
    const id = setInterval(
      () =>
        setClock(
          new Date().toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        ),
      1000
    );
    return () => clearInterval(id);
  }, []);

  function getUnitPrice(p: (typeof products)[number]) {
    const srp = Number(p.srp);
    const base = Number(p.price);
    if (Number.isFinite(srp) && srp > 0) return srp; // prefer SRP if set
    if (Number.isFinite(base) && base > 0) return base; // fallback to price
    return null; // no price set
  }

  return (
    <main className="kiosk-wrapper min-h-screen bg-white text-gray-900 p-4 mx-auto max-w-[1200px] grid gap-4 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)_380px] items-start overflow-x-hidden]">
      {/* HEADER */}
      <header className="md:col-span-3 sticky top-0 z-10 bg-white border-b border-gray-200 -m-4 mb-0 px-4">
        <div className="h-14 flex items-center justify-between">
          <div className="text-sm leading-tight">
            <div className="font-semibold">Branch Name</div>
            <div className="text-xs text-gray-600">Terminal: KIOSK-01</div>
          </div>
          <div className="text-sm tabular-nums" aria-label="clock">
            {clock}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCart({})}
              className="px-3 py-2 rounded border text-sm"
              title="Start a fresh cart"
            >
              New Cart
            </button>
            <button
              onClick={() => setCart({})}
              className="px-3 py-2 rounded bg-black text-white text-sm"
            >
              Clear
            </button>
          </div>
        </div>
      </header>

      {/* Top controls (mobile only): chips + search */}
      <div className="md:hidden flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto">
          <button
            className={`px-3 py-2 rounded text-sm border ${
              activeCat === "" ? "bg-black text-white" : ""
            }`}
            onClick={() => setActiveCat("")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`px-3 py-2 rounded text-sm border ${
                activeCat === c.id ? "bg-black text-white" : ""
              }`}
              onClick={() => setActiveCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-500"
          />
        </div>
      </div>

      {/* LEFT: Sticky category sidebar (tablet/desktop) */}
      <aside className="border border-gray-200 rounded-lg p-3 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-auto bg-white">
        <div className="font-semibold mb-2">Categories</div>
        <div className="flex flex-col gap-2">
          <button
            className={`px-3 py-2 rounded text-sm border text-left ${
              activeCat === "" ? "bg-black text-white" : ""
            }`}
            onClick={() => setActiveCat("")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`px-3 py-2 rounded text-sm border text-left ${
                activeCat === c.id ? "bg-black text-white" : ""
              }`}
              onClick={() => setActiveCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </aside>

      {/* Product grid */}
      <section className="border border-gray-200 rounded-lg p-3 bg-white overflow-hidden">
        {/* Search (tablet/desktop) */}
        <div className="hidden md:flex gap-2 mb-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-500"
          />
          <select
            value={activeBrand === "" ? "" : String(activeBrand)}
            onChange={(e) =>
              setActiveBrand(e.target.value ? Number(e.target.value) : "")
            }
            className="w-48 border border-gray-300 rounded px-2 py-2 text-sm bg-white text-gray-900"
          >
            <option value="">All brands</option>
            {brandOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <h2 className="font-semibold mb-2">Products</h2>

        {filtered.length === 0 ? (
          <div className="text-sm text-gray-500">No results.</div>
        ) : (
          <div
            className="space-y-2 overflow-y-auto pr-1"
            style={{ maxHeight: "calc(100vh - 14rem)" }}
          >
            {filtered.map((p) => {
              const inCart = cart[p.id];

              // units & container
              const unit = p.unit?.name ?? "unit";
              const packUnit = p.packingUnit?.name ?? "pack";
              const packSize = Number(p.packingSize ?? 0) || 0;

              // stocks: packs always; retail only when allowed
              const retailStock = typeof p.stock === "number" ? p.stock : null; // loose (kg/pcs)
              const packStock =
                typeof p.packingStock === "number" ? p.packingStock : null; // whole packs
              const minStock =
                typeof p.minStock === "number" ? p.minStock : null;

              // out/low flags
              const isOut = (retailStock ?? 0) <= 0 && (packStock ?? 0) <= 0;
              const isLowStock =
                !isOut &&
                ((packStock !== null && packStock <= 1) ||
                  (p.allowPackSale &&
                    retailStock !== null &&
                    minStock !== null &&
                    retailStock > 0 &&
                    retailStock <= minStock));

              // DB-price rules (no manipulation):
              // - retail price = p.price (only if allowPackSale)
              // - pack price   = p.srp   (used by backend add() for pack-only items)
              const hasRetailPrice = !!p.allowPackSale && Number(p.price) > 0;
              const hasPackPrice = Number(p.srp) > 0;

              // can add? retail items need price; pack-only items need srp
              const canAdd = p.allowPackSale ? hasRetailPrice : hasPackPrice;

              return (
                <div
                  key={p.id}
                  className="border border-gray-200 rounded-lg p-2 bg-white"
                >
                  <div className="flex gap-2 items-start">
                    {/* Thumb */}
                    <div className="w-12 h-12 rounded-md overflow-hidden bg-gray-100 border flex items-center justify-center shrink-0">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[10px] text-gray-400">
                          No Img
                        </span>
                      )}
                    </div>

                    {/* Content (name/brand, price, stock) */}
                    <div className="min-w-0 flex-1">
                      {/* line 1: name/brand on left, badges on right */}
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-gray-900 truncate">
                            {p.name}
                          </div>
                          {p.brand?.name && (
                            <div className="text-[11px] text-gray-500 truncate">
                              {p.brand.name}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 justify-self-end">
                          {isLowStock && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              Low
                            </span>
                          )}
                          {isOut && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                              Out
                            </span>
                          )}
                        </div>
                      </div>

                      {/* line 2: price (retail only; no computed pack price) */}
                      <div className="mt-1 text-[11px] text-gray-700 flex flex-wrap gap-x-3 gap-y-1 min-w-0">
                        {hasRetailPrice && (
                          <span className="truncate">
                            <strong>{peso(Number(p.price))}</strong>
                            <span className="text-gray-500"> / {unit}</span>
                          </span>
                        )}
                        {Number(p.srp) > 0 && (
                          <span className="truncate">
                            <strong>{peso(Number(p.srp))}</strong>
                            <span className="text-gray-500"> / {packUnit}</span>
                          </span>
                        )}
                      </div>

                      {/* line 3: stocks & container */}
                      <div className="mt-1 text-[11px] text-gray-700 flex flex-wrap items-center gap-2">
                        {typeof packStock === "number" && (
                          <span className="truncate">
                            <strong>Stock:</strong> {Math.max(0, packStock)}{" "}
                            {packUnit}
                            {packStock === 1 ? "" : "s"}
                          </span>
                        )}
                        {p.allowPackSale && typeof retailStock === "number" && (
                          <span className="text-gray-500 truncate">
                            <strong>Retail Stock:</strong>{" "}
                            {Math.max(0, +retailStock.toFixed(2))} {unit}
                          </span>
                        )}
                        {packSize > 0 &&
                          p.unit?.name &&
                          p.packingUnit?.name && (
                            <span className="text-gray-500 truncate">
                              Container: {packSize} {unit} / {packUnit}
                            </span>
                          )}
                      </div>
                    </div>

                    {/* Controls (right) */}
                    <div className="shrink-0">
                      {!inCart ? (
                        <button
                          onClick={() => add(p)}
                          disabled={
                            isOut ||
                            !canAdd ||
                            (!p.allowPackSale && packSize <= 0)
                          }
                          className={`px-3 py-1.5 rounded text-[12px] ${
                            isOut ||
                            !canAdd ||
                            (!p.allowPackSale && packSize <= 0)
                              ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                              : "bg-black text-white"
                          }`}
                        >
                          {isOut ? "Out" : !canAdd ? "Set price" : "Add"}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => dec(p.id)}
                            disabled={isOut}
                            className={`px-2.5 py-1.5 rounded ${
                              isOut
                                ? "bg-gray-100 text-gray-400"
                                : "bg-gray-200"
                            }`}
                            aria-label="Decrease"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            step={inCart.step}
                            min={inCart.step}
                            max={999}
                            value={inCart.qty}
                            onChange={(e) =>
                              setQty(p.id, Number(e.target.value))
                            }
                            disabled={isOut}
                            className={`w-16 text-sm border border-gray-300 rounded px-2 py-1 text-right ${
                              isOut
                                ? "bg-gray-50 text-gray-400"
                                : "bg-white text-gray-900"
                            }`}
                            aria-label="Quantity"
                          />
                          <button
                            onClick={() => inc(p.id)}
                            disabled={isOut}
                            className={`px-2.5 py-1.5 rounded ${
                              isOut
                                ? "bg-gray-100 text-gray-400"
                                : "bg-gray-200"
                            }`}
                            aria-label="Increase"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Cart panel */}
      <aside className="border border-gray-200 rounded-lg p-3 sticky top-3 h-fit bg-white">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Cart</h2>
          <button
            onClick={() => setCart({})}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
            disabled={items.length === 0}
          >
            Clear
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-sm text-gray-500 mt-2">Cart is empty.</div>
        ) : (
          <>
            <div className="mt-2 space-y-2 max-h-[50vh] overflow-auto pr-1">
              {items.map((it) => (
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
                    <button
                      onClick={() => dec(it.id)}
                      className="px-2 rounded bg-gray-200 text-sm"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step={it.step}
                      min={it.step}
                      max={99}
                      value={it.qty}
                      onChange={(e) => setQty(it.id, Number(e.target.value))}
                      className="w-16 text-sm border border-gray-300 rounded px-2 py-1 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => inc(it.id)}
                      className="px-2 rounded bg-gray-200 text-sm"
                    >
                      +
                    </button>
                    <button
                      onClick={() =>
                        setCart((p) => {
                          const c = { ...p };
                          delete c[it.id];
                          return c;
                        })
                      }
                      className="px-2 rounded text-red-600 text-sm"
                    >
                      🗑
                    </button>
                  </div>
                  <div className="w-24 text-right font-medium">
                    {peso(it.qty * it.unitPrice)}
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
              <button
                className="w-full py-2 rounded bg-black text-white text-sm"
                disabled={items.length === 0}
              >
                Print Order Slip
              </button>
            </Form>
          </>
        )}
      </aside>

      {/* FOOTER */}
      <footer className="md:col-span-3 text-xs text-gray-600 border-t border-gray-200 pt-2 mt-2">
        Tips: <kbd>/</kbd> focus search • <kbd>+</kbd>/<kbd>−</kbd> adjust qty •
        Low stock badge legend coming next • v0.1
      </footer>
    </main>
  );
}
