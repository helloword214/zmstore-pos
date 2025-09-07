import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useRevalidator,
  useFetcher,
  useNavigate,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { TextInput } from "~/components/ui/TextInput";

type CreateSlipResp =
  | { ok: true; id: number }
  | { ok: false; errors: Array<{ id: number; mode?: string; reason: string }> };

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

  const createSlip = useFetcher<CreateSlipResp>();
  const navigate = useNavigate();
  const [printSlip, setPrintSlip] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState<{
    open: boolean;
    id?: number;
    code?: string;
  }>({ open: false });

  const [errorOpen, setErrorOpen] = React.useState(false);

  const [clientErrors, setClientErrors] = React.useState<
    Array<{ id: number; mode?: string; reason: string }>
  >([]);
  // UI state
  const [q, setQ] = React.useState("");
  const [activeCat, setActiveCat] = React.useState<number | "">("");
  const [activeBrand, setActiveBrand] = React.useState<number | "">("");

  const searchRef = React.useRef<HTMLInputElement | null>(null);

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
      if (
        activeBrand !== "" &&
        Number(p.brand?.id ?? 0) !== Number(activeBrand)
      )
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

  // Fast lookup for validation
  const productById = React.useMemo(() => {
    const map = new Map<number, (typeof products)[number]>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

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

  // Ensure each cart line has a 'mode' ("retail" | "pack").
  // If your cart items already store 'mode', this will include it.
  const payload = JSON.stringify(
    items.map(({ id, name, qty, unitPrice, mode }) => ({
      id,
      name,
      qty,
      unitPrice,
      mode, // may be undefined for old carts; server will infer if missing
    }))
  );

  // Handle fetcher response: navigate on success; show modal on 400
  React.useEffect(() => {
    if (createSlip.state !== "idle" || !createSlip.data) return;
    if (createSlip.data.ok === true) {
      // If printing is requested, go to slip page (auto-print can be handled there)
      if (printSlip) {
        navigate(`/orders/${createSlip.data.id}/slip?autoprint=1&autoback=1`, {
          replace: true,
        });
      } else {
        // No print: show code/QR so staff can relay to cashier quickly
        setJustCreated({
          open: true,
          id: createSlip.data.id,
          code: (createSlip.data as any).orderCode,
        });
        // Clear cart after creation (optional: keep? choose UX)
        setCart({});
      }
    } else {
      setClientErrors([]); // server-side errors will be shown
      setErrorOpen(true);
    }
  }, [createSlip.state, createSlip.data, navigate, printSlip]);
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

  // Global key handler: "/" focuses the search field
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.defaultPrevented) {
        // don't steal focus when typing in inputs/textareas/contenteditable
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            (t as any).isContentEditable)
        )
          return;
        e.preventDefault();
        // try explicit ref first, then fallback to querySelector (works for TextInput)
        (
          searchRef.current ??
          document.querySelector<HTMLInputElement>('input[name="search"]')
        )?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── UI helpers for nicer buttons ──────────────────────────
  // ✅ keep these names; only classes updated
  const btnBase =
    "inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-sm transition shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200";

  const btnOutline =
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:shadow-none";

  const btnDisabled =
    "border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed";

  const priceChip =
    "ml-2 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 ring-1 ring-inset ring-slate-200";

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

  // ── Client-side preflight validation (mirrors server rules) ────────────────
  function validateCartForSubmit(): Array<{
    id: number;
    mode?: "retail" | "pack";
    reason: string;
  }> {
    const errs: Array<{
      id: number;
      mode?: "retail" | "pack";
      reason: string;
    }> = [];
    const eps = 1e-6;
    for (const line of items) {
      const p = productById.get(line.id);
      if (!p) {
        errs.push({ id: line.id, reason: "Product no longer exists" });
        continue;
      }
      const price = Number(p.price ?? 0);
      const srp = Number(p.srp ?? 0);
      const packStock = Number(p.stock ?? 0); // packs
      const retailStock = Number(p.packingStock ?? 0); // retail units
      if (line.mode === "retail") {
        if (!p.allowPackSale) {
          errs.push({ id: p.id, mode: "retail", reason: "Retail not allowed" });
          continue;
        }
        if (!(price > 0)) {
          errs.push({
            id: p.id,
            mode: "retail",
            reason: "Retail price not set",
          });
        }
        // qty must be a multiple of 0.25 → check in hundredths against 25
        const hundredths = Math.round(line.qty * 100); // integer in cents
        if (Math.abs(hundredths % 25) > eps) {
          errs.push({
            id: p.id,
            mode: "retail",
            reason: "Retail qty must be a multiple of 0.25",
          });
        }
        if (!(line.qty > 0)) {
          errs.push({
            id: p.id,
            mode: "retail",
            reason: "Retail qty must be > 0",
          });
        }
        if (line.qty - retailStock > eps) {
          errs.push({
            id: p.id,
            mode: "retail",
            reason: `Retail qty exceeds stock (${retailStock})`,
          });
        }
        if (Math.abs(line.unitPrice - price) > eps) {
          errs.push({
            id: p.id,
            mode: "retail",
            reason: "Retail price changed — refresh kiosk",
          });
        }
      } else {
        // PACK
        if (!(srp > 0)) {
          errs.push({ id: p.id, mode: "pack", reason: "Pack price not set" });
        }
        if (!Number.isInteger(line.qty)) {
          errs.push({
            id: p.id,
            mode: "pack",
            reason: "Pack qty must be an integer",
          });
        }
        if (!(line.qty > 0)) {
          errs.push({ id: p.id, mode: "pack", reason: "Pack qty must be > 0" });
        }
        if (line.qty > packStock) {
          errs.push({
            id: p.id,
            mode: "pack",
            reason: `Pack qty exceeds stock (${packStock})`,
          });
        }
        if (Math.abs(line.unitPrice - srp) > eps) {
          errs.push({
            id: p.id,
            mode: "pack",
            reason: "Pack price changed — refresh kiosk",
          });
        }
      }
    }
    return errs;
  }

  function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Run preflight; if any errors, stop and show modal
    const errs = validateCartForSubmit();
    if (errs.length) {
      e.preventDefault();
      setClientErrors(errs);
      setErrorOpen(true);
    } else {
      setClientErrors([]);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900 mx-auto  p-0 md:p-4 grid gap-4 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)_380px] items-start overflow-x-hidden">
      {/* HEADER */}
      <header className="md:col-span-3 sticky top-0 z-10 -mx-0 -mt-0 bg-white/85 backdrop-blur border-b border-slate-200">
        <div className="h-14 mx-auto px-4 flex items-center justify-between">
          <div className="text-sm leading-tight">
            <div className="font-semibold tracking-tight text-slate-900">
              Zaldy Merhcandise
            </div>
            <div className="text-xs text-gray-600">Order Pad: OP-01</div>
          </div>
          <div
            className="text-sm tabular-nums text-slate-700"
            aria-label="clock"
          >
            {clock}
          </div>
          <div className="flex gap-2">
            {/* New Order resets cart + search + filters */}
            <button
              onClick={() => {
                setCart({});
                setQ("");
                setActiveCat("");
                setActiveBrand("");
                // focus search after reset
                const el =
                  document.querySelector<HTMLInputElement>(
                    'input[name="search"]'
                  ) || searchRef.current;
                el?.focus();
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none"
              title="Start a fresh cart"
            >
              New Order
            </button>
            {/* Clear now only clears cart (keeps filters/search) */}
            <button
              onClick={() => setCart({})}
              className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm shadow-sm hover:bg-indigo-700"
            >
              Clear
            </button>
          </div>
        </div>
      </header>

      {/* Top controls (mobile only): chips + search */}
      <div className="md:hidden flex flex-col gap-3 px-4">
        <div className="flex gap-2 overflow-x-auto">
          <button
            className={`px-3 py-2 rounded-xl text-sm border ${
              activeCat === ""
                ? "bg-indigo-600 text-white border-indigo-600"
                : "border-slate-200 bg-white text-slate-700"
            }`}
            onClick={() => setActiveCat("")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`px-3 py-2 rounded-xl text-sm border ${
                activeCat === c.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
              onClick={() => setActiveCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            ref={searchRef}
            name="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </div>

      {/* LEFT: Sticky category sidebar (tablet/desktop) */}
      <aside className="hidden md:block border border-slate-200 rounded-2xl p-3 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-auto bg-white shadow-sm">
        <div className="font-semibold mb-2 text-slate-800">Categories</div>
        <div className="flex flex-col gap-2">
          <button
            className={`px-3 py-2 rounded-xl text-sm text-left border ${
              activeCat === ""
                ? "bg-indigo-600 text-white border-indigo-600"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setActiveCat("")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`px-3 py-2 rounded-xl text-sm text-left border ${
                activeCat === c.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => setActiveCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </aside>

      {/* Product grid */}
      <section className="border border-slate-200 rounded-2xl p-3 md:p-4 bg-white overflow-hidden shadow-sm">
        {/* Search (tablet/desktop) */}
        <div className="hidden md:flex gap-2 mb-3">
          <div className="flex-1">
            <TextInput
              label="Search"
              name="search"
              placeholder="🔍 Search products…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div className="w-56">
            <SelectInput
              label="Brand"
              name="brand"
              value={String(activeBrand ?? "")}
              onChange={(val) => setActiveBrand(val ? Number(val) : "")}
              options={[
                { label: "All brands", value: "", style: { color: "#6b7280" } },
                ...brandOptions.map(([id, name]) => ({
                  label: name,
                  value: String(id),
                })),
              ]}
            />
          </div>
        </div>

        <h2 className="font-semibold mb-2 text-slate-800">Products</h2>

        {filtered.length === 0 ? (
          <div className="text-sm text-slate-500">No results.</div>
        ) : (
          <div
            className="space-y-2 overflow-y-auto pr-1"
            style={{ maxHeight: "calc(100vh - 14rem)" }}
          >
            {filtered.map((p) => {
              // (all your original logic here unchanged)
              const unit = p.unit?.name ?? "unit";
              const packUnit = p.packingUnit?.name ?? "pack";
              const packSize = Number(p.packingSize ?? 0);
              const packStock = Number(p.stock ?? 0);
              const retailStock = Number(p.packingStock ?? 0);
              const price = Number(p.price ?? 0);
              const srp = Number(p.srp ?? 0);
              const minStock = p.minStock ?? null;
              const retailAvailable =
                !!p.allowPackSale && retailStock > 0 && price > 0;
              const packAvailable = packStock > 0 && srp > 0;
              const isOut = !retailAvailable && !packAvailable;
              const isLowStock =
                !isOut &&
                ((packAvailable && packStock <= 1) ||
                  (p.allowPackSale &&
                    minStock != null &&
                    retailStock > 0 &&
                    retailStock <= minStock));
              const cardDisabled = isOut;

              return (
                <div
                  key={p.id}
                  className={`border border-slate-200 rounded-2xl p-3 bg-white shadow-sm hover:shadow ${
                    cardDisabled ? "opacity-60" : ""
                  }`}
                  aria-disabled={cardDisabled}
                >
                  <div className="flex gap-3 items-start">
                    {/* Thumb */}
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          No Img
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {/* line 1: name + tags */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm text-slate-900 truncate">
                            {p.name}
                          </span>
                          {isLowStock && (
                            <span
                              className="flex-none text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                              title="Low stock"
                            >
                              Low
                            </span>
                          )}
                          {isOut && (
                            <span
                              className="flex-none text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200"
                              title="Out of stock"
                            >
                              Out
                            </span>
                          )}
                        </div>
                        {p.brand?.name && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {p.brand.name}
                          </div>
                        )}
                      </div>

                      {/* line 2: stocks & container */}
                      <div className="mt-1 text-[11px] text-slate-700 flex flex-wrap items-center gap-2">
                        <span className="truncate">
                          <strong>Stock:</strong> {Math.max(0, packStock)}{" "}
                          {packUnit}
                          {packStock === 1 ? "" : "s"}
                        </span>

                        {p.allowPackSale && (
                          <span className="text-slate-500 truncate">
                            <strong>Retail Stock:</strong>{" "}
                            {Math.max(0, +retailStock.toFixed(2))} {unit}
                          </span>
                        )}

                        {packSize > 0 &&
                          p.unit?.name &&
                          p.packingUnit?.name && (
                            <span className="text-slate-500 truncate">
                              Container: {packSize} {unit} / {packUnit}
                            </span>
                          )}

                        {/* Hints for partial empties */}
                        {p.allowPackSale &&
                          !retailAvailable &&
                          packAvailable && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                              Retail empty — open {packUnit.toLowerCase()}{" "}
                              needed
                            </span>
                          )}
                        {!packAvailable && retailAvailable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-600 ring-1 ring-slate-200">
                            Pack stock empty
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Controls (right) */}
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

                          {/* Pack Add */}
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
                        // Pack-only
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
      <aside className="border border-slate-200 rounded-2xl p-3 md:p-4 sticky top-3 h-fit bg-white shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Order List</h2>
          <button
            onClick={() => setCart({})}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
            disabled={items.length === 0}
          >
            Clear
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-sm text-slate-500 mt-2">Order is empty.</div>
        ) : (
          <>
            <div className="mt-3 space-y-2 max-h-[50vh] overflow-auto pr-1">
              {items.map((it) => (
                <div
                  key={it.key}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {it.name}{" "}
                      <span className="text-[10px] uppercase text-slate-500">
                        [{it.mode}]
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {it.qty} × {peso(it.unitPrice)}{" "}
                      {it.mode === "retail" ? `/${it.unitLabel}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => dec(it.key)}
                      className="px-2 rounded-lg bg-slate-200/80 hover:bg-slate-200 text-sm"
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
                      className="w-16 text-sm rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                    />
                    <button
                      onClick={() => inc(it.key)}
                      className="px-2 rounded-lg bg-slate-200/80 hover:bg-slate-200 text-sm"
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
                      className="px-2 rounded-lg text-red-600 text-sm hover:bg-red-50"
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
              <div className="text-sm text-slate-600">Subtotal</div>
              <div className="font-semibold text-slate-900">
                {peso(subtotal)}
              </div>
            </div>

            <createSlip.Form
              method="post"
              action="/orders/new?respond=json"
              className="mt-3"
              onSubmit={handleCreateSubmit}
            >
              <input type="hidden" name="items" value={payload} />
              <input type="hidden" name="terminalId" value="KIOSK-01" />
              <label className="mt-2 mb-2 inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  checked={printSlip}
                  onChange={(e) => setPrintSlip(e.target.checked)}
                />
                <span>Print slip after create</span>
              </label>
              <button
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                disabled={items.length === 0 || createSlip.state !== "idle"}
              >
                {createSlip.state !== "idle"
                  ? "Creating…"
                  : printSlip
                  ? "Create & Print Ticket"
                  : "Create Order"}
              </button>
            </createSlip.Form>
          </>
        )}
      </aside>

      {/* FOOTER */}
      <footer className="md:col-span-3 text-xs text-slate-600 border-t border-slate-200 pt-2 mt-2 px-4">
        Tips: <kbd>/</kbd> focus search • <kbd>+</kbd>/<kbd>−</kbd> adjust qty •
        Low stock badge legend coming next • v0.1
      </footer>

      {/* Post-create success (no print) */}
      {justCreated.open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/40"
            onClick={() => setJustCreated({ open: false })}
          />
          <div
            role="document"
            className="relative w-full max-w-sm rounded-2xl bg-white shadow-lg p-5 text-center border border-slate-200"
          >
            <div className="font-semibold text-lg text-slate-900">
              Order Created
            </div>
            <div className="mt-1.5 text-sm text-slate-600">
              Show this code to the cashier
            </div>
            <div className="mt-3">
              <div className="text-[11px] text-slate-500">Order Code</div>
              <div className="font-mono text-2xl tracking-wider text-slate-900">
                {justCreated.code}
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              {justCreated.code ? (
                <img
                  className="w-28 h-28"
                  alt="QR"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                    justCreated.code
                  )}`}
                />
              ) : null}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setJustCreated({ open: false })}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Order creation errors (server validation) */}
      {errorOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setErrorOpen(false)}
          />
          <div
            role="document"
            className="relative w-full max-w-md rounded-2xl bg-white shadow-lg p-5 border border-slate-200"
          >
            <div className="font-semibold mb-2 text-slate-900">
              Can’t print ticket
            </div>
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 max-h-64 overflow-auto">
              {(clientErrors.length
                ? clientErrors
                : createSlip.data && createSlip.data.ok === false
                ? createSlip.data.errors
                : []
              ).map((e, i) => (
                <li key={i}>
                  <span className="font-medium">Product #{e.id}</span>
                  {e.mode ? ` (${e.mode})` : ""}: {e.reason}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setErrorOpen(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
