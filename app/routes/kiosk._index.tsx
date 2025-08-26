import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useRevalidator } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

// ─────────────────────────────────────────────────────────────
// Loader: fetch + normalize numerics, disable caching
// ─────────────────────────────────────────────────────────────
export const loader: LoaderFunction = async () => {
  const [categories, rawProducts] = await Promise.all([
    db.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        price: true, // Decimal | number | string
        srp: true, // Decimal | number | string
        allowPackSale: true,
        packingStock: true, // number | null
        packingSize: true, // Decimal | number | string | null
        stock: true, // Decimal | number | string | null
        minStock: true, // Decimal | number | string | null
        categoryId: true,
        brand: { select: { id: true, name: true } },
        imageUrl: true,
        unit: { select: { name: true } }, // retail unit
        packingUnit: { select: { name: true } }, // pack unit
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);

  const products = rawProducts.map((p) => ({
    ...p,
    price: p.price == null ? 0 : Number(p.price),
    srp: p.srp == null ? 0 : Number(p.srp),
    stock: p.stock == null ? null : Number(p.stock),
    minStock: p.minStock == null ? null : Number(p.minStock),
    packingSize: p.packingSize == null ? 0 : Number(p.packingSize),
    packingStock: p.packingStock == null ? 0 : Number(p.packingStock),
  }));

  return json(
    { categories, products },
    { headers: { "Cache-Control": "no-store" } }
  );
};

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function KioskPage() {
  const { categories, products } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // UI state
  const [q, setQ] = React.useState("");
  const [activeCat, setActiveCat] = React.useState<number | "">("");
  const [activeBrand, setActiveBrand] = React.useState<number | "">("");

  // cart: id -> item snapshot

  type Mode = "retail" | "pack";
  type CartItem = {
    key: string;
    id: number;
    name: string;
    mode: Mode;
    unitLabel: string;
    unitPrice: number;
    qty: number;
    step: number;
  };
  const makeKey = (id: number, mode: Mode) => `${id}:${mode}`;

  // cart now keyed by id:mode
  const [cart, setCart] = React.useState<Record<string, CartItem>>({});

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

  // cart ops
  const add = (p: (typeof products)[number], mode: Mode) => {
    const unitPrice = mode === "retail" ? Number(p.price) : Number(p.srp);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return;

    const step = mode === "retail" ? 0.25 : 1;
    const unitLabel =
      mode === "retail"
        ? p.unit?.name ?? "unit"
        : p.packingUnit?.name ?? "pack";
    const key = makeKey(p.id, mode);

    setCart((prev) => {
      const ex = prev[key];
      const nextQty = +(ex ? ex.qty + step : step).toFixed(2);
      return {
        ...prev,
        [key]: {
          key,
          id: p.id,
          name: p.name,
          mode,
          unitLabel,
          unitPrice,
          qty: nextQty,
          step,
        },
      };
    });
  };

  const inc = (key: string) =>
    setCart((prev) => {
      const ex = prev[key];
      if (!ex) return prev;
      return { ...prev, [key]: { ...ex, qty: +(ex.qty + ex.step).toFixed(2) } };
    });

  const dec = (key: string) =>
    setCart((prev) => {
      const ex = prev[key];
      if (!ex) return prev;
      const next = +(ex.qty - ex.step).toFixed(2);
      const copy = { ...prev };
      if (next <= 0) delete copy[key];
      else copy[key] = { ...ex, qty: next };
      return copy;
    });

  const setQty = (key: string, qty: number) =>
    setCart((prev) => {
      const ex = prev[key];
      if (!ex) return prev;
      const clamped = Math.max(
        ex.step,
        Math.min(999, Math.round(qty * 100) / 100)
      );
      return { ...prev, [key]: { ...ex, qty: clamped } };
    });

  const items = Object.values(cart);
  const subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const payload = JSON.stringify(
    items.map(({ id, name, qty, unitPrice }) => ({ id, name, qty, unitPrice }))
  );

  // header clock
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

  // revalidate on focus + light polling (keeps kiosk fresh)
  React.useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, 15000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, [revalidator]);

  // ── UI helpers for nicer buttons ──────────────────────────
  const btnBase =
    "inline-flex items-center gap-1 rounded-md border text-[12px] px-3 py-1.5 shadow-sm transition-colors";
  const btnOutline =
    "bg-white text-gray-800 border-gray-300 hover:bg-gray-50 active:bg-gray-100";
  const btnDisabled =
    "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed";
  const priceChip =
    "ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600";

  function packAddLabel(p: {
    packingUnit?: { name?: string } | null;
    packingSize?: number | null;
    unit?: { name?: string } | null;
  }) {
    const pu = p.packingUnit?.name?.trim() || "Pack";
    const size = Number(p.packingSize ?? 0);
    const u = p.unit?.name?.trim() || "unit";
    return size > 0 ? `Add ${pu} (${size} ${u})` : `Add ${pu}`;
  }
  function retailAddLabel(p: { unit?: { name?: string } | null }) {
    const u = p.unit?.name?.trim() || "unit";
    return `Add by ${u}`;
  }

  return (
    <main className="kiosk-wrapper min-h-screen bg-white text-gray-900 p-4 mx-auto max-w-[1200px] grid gap-4 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)_380px] items-start overflow-x-hidden">
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
              const packSize = Number(p.packingSize ?? 0);

              // 🔄 DB meaning:
              // - stock          = PACK COUNT (tanks/sacks)
              // - packingStock   = RETAIL UNITS (kg/pcs)
              const packStock = Number(p.stock ?? 0); // whole packs available
              const retailStock = Number(p.packingStock ?? 0); // retail units available

              const price = Number(p.price ?? 0); // retail price per unit
              const srp = Number(p.srp ?? 0); // price per pack
              const minStock = p.minStock ?? null; // low retail threshold

              // availability by channel
              const retailAvailable =
                !!p.allowPackSale && retailStock > 0 && price > 0;
              const packAvailable = packStock > 0 && srp > 0;

              // overall state
              const isOut = !retailAvailable && !packAvailable;
              const isLowStock =
                !isOut &&
                ((packAvailable && packStock <= 1) ||
                  (p.allowPackSale &&
                    minStock != null &&
                    retailStock > 0 &&
                    retailStock <= minStock));

              // Add button targets retail if allowPackSale else pack
              const addIsRetail = !!p.allowPackSale;
              const canAdd = addIsRetail ? retailAvailable : packAvailable;

              // disable when out or already in cart
              const cardDisabled = isOut || !!inCart;

              return (
                <div
                  key={p.id}
                  className={`border border-gray-200 rounded-lg p-2 bg-white ${
                    cardDisabled ? "opacity-60" : ""
                  }`}
                  aria-disabled={cardDisabled}
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
                      {/* line 1: name + small inline tags */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-medium text-sm text-gray-900 truncate">
                            {p.name}
                          </span>
                          {isLowStock && (
                            <span
                              className="flex-none text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200"
                              title="Low stock"
                            >
                              Low
                            </span>
                          )}
                          {isOut && (
                            <span
                              className="flex-none text-[10px] px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200"
                              title="Out of stock"
                            >
                              Out
                            </span>
                          )}
                        </div>
                        {p.brand?.name && (
                          <div className="text-[11px] text-gray-500 truncate">
                            {p.brand.name}
                          </div>
                        )}
                      </div>
                      {/* line 2: stocks & container */}
                      <div className="mt-1 text-[11px] text-gray-700 flex flex-wrap items-center gap-2">
                        <span className="truncate">
                          <strong>Stock:</strong> {Math.max(0, packStock)}{" "}
                          {packUnit}
                          {packStock === 1 ? "" : "s"}
                        </span>

                        {p.allowPackSale && (
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

                        {/* Hints for partial empties */}
                        {p.allowPackSale &&
                          !retailAvailable &&
                          packAvailable && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              Retail empty — open sack needed
                            </span>
                          )}
                        {!packAvailable && retailAvailable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
                            Pack stock empty
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Controls (right) — allow adding BOTH modes (clean UI) */}
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {p.allowPackSale ? (
                        <>
                          {/* Retail Add */}
                          {(() => {
                            const inCartRetail = Boolean(
                              cart[makeKey(p.id, "retail")]
                            );
                            const retailOk =
                              retailStock > 0 && Number(p.price) > 0;
                            const disabled = inCartRetail || !retailOk;
                            const title = inCartRetail
                              ? "Already in cart (retail)"
                              : !retailOk
                              ? "Retail unavailable (no stock/price)"
                              : `Add by ${unit} at ${peso(Number(p.price))}`;
                            return (
                              <button
                                onClick={() => add(p, "retail")}
                                disabled={disabled}
                                title={title}
                                className={`${btnBase} ${
                                  disabled ? btnDisabled : btnOutline
                                }`}
                              >
                                <span>➕ {retailAddLabel(p)}</span>
                                {Number(p.price) > 0 && (
                                  <span className={priceChip}>
                                    {peso(Number(p.price))}
                                  </span>
                                )}
                              </button>
                            );
                          })()}

                          {/* Pack Add (outline pill + price chip) */}
                          {(() => {
                            const inCartPack = Boolean(
                              cart[makeKey(p.id, "pack")]
                            );
                            const packOk = packStock > 0 && Number(p.srp) > 0;
                            const disabled = inCartPack || !packOk;
                            const title = inCartPack
                              ? "Already in cart (pack)"
                              : !packOk
                              ? "Pack unavailable (no stock/price)"
                              : `Add ${packUnit} at ${peso(Number(p.srp))}`;
                            return (
                              <button
                                onClick={() => add(p, "pack")}
                                disabled={disabled}
                                title={title}
                                className={`${btnBase} ${
                                  disabled ? btnDisabled : btnOutline
                                }`}
                              >
                                <span>➕ {packAddLabel(p)}</span>
                                {Number(p.srp) > 0 && (
                                  <span className={priceChip}>
                                    {peso(Number(p.srp))}
                                  </span>
                                )}
                              </button>
                            );
                          })()}
                        </>
                      ) : (
                        // Pack-only product
                        // Pack-only product (outline pill + price chip)
                        (() => {
                          const inCartPack = Boolean(
                            cart[makeKey(p.id, "pack")]
                          );
                          const packOk = packStock > 0 && Number(p.srp) > 0;
                          const disabled = inCartPack || !packOk;
                          const title = inCartPack
                            ? "Already in cart"
                            : !packOk
                            ? "Pack unavailable (no stock/price)"
                            : `Add ${packUnit} at ${peso(Number(p.srp))}`;
                          return (
                            <button
                              onClick={() => add(p, "pack")}
                              disabled={disabled}
                              title={title}
                              className={`${btnBase} ${
                                disabled ? btnDisabled : btnOutline
                              }`}
                            >
                              <span>➕ {packAddLabel(p)}</span>
                              {Number(p.srp) > 0 && (
                                <span className={priceChip}>
                                  {peso(Number(p.srp))}
                                </span>
                              )}
                            </button>
                          );
                        })()
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
                  key={it.key}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {it.name}{" "}
                      <span className="text-[10px] uppercase text-gray-500">
                        [{it.mode}]
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">
                      {it.qty} × {peso(it.unitPrice)}{" "}
                      {it.mode === "retail" ? `/${it.unitLabel}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => dec(it.key)}
                      className="px-2 rounded bg-gray-200 text-sm"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step={it.step}
                      min={it.step}
                      max={999}
                      value={it.qty}
                      onChange={(e) => setQty(it.key, Number(e.target.value))}
                      className="w-16 text-sm border border-gray-300 rounded px-2 py-1 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => inc(it.key)}
                      className="px-2 rounded bg-gray-200 text-sm"
                    >
                      +
                    </button>
                    <button
                      onClick={() =>
                        setCart((p) => {
                          const c = { ...p };
                          delete c[it.key];
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
