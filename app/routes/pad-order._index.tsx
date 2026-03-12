import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useRevalidator,
  useFetcher,
  useNavigate,
  Form,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { TextInput } from "~/components/ui/TextInput";
import { useCustomerSearch } from "~/hooks/useCustomerSearch";
import { requireRole } from "~/utils/auth.server";

import { useLocalStorageState } from "~/utils/hooks";

type PickedCustomer = {
  id: number;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  alias?: string | null;
  phone?: string | null;
  addresses?: Array<{
    id: number;
    label?: string | null;
    line1?: string | null;
    barangay?: string | null;
    city?: string | null;
    province?: string | null;
    landmark?: string | null;
  }>;
};

type CreateSlipResp =
  | {
      ok: true;
      id: number;
      orderCode: string;
      channel: "PICKUP" | "DELIVERY";
    }
  | { ok: false; errors: Array<{ id: number; mode?: string; reason: string }> };

type ResettableFetcher<T> = ReturnType<typeof useFetcher<T>> & {
  reset?: () => void;
};
// ─────────────────────────────────────────────────────────────
// Loader: fetch + normalize numerics, disable caching
// ─────────────────────────────────────────────────────────────
export const loader: LoaderFunction = async ({ request }) => {
  // 🔒 Gate: operational order creation roles only
  const me = await requireRole(request, [
    "CASHIER",
    "STORE_MANAGER",
    "EMPLOYEE",
  ]);
  const backTo =
    me.role === "STORE_MANAGER"
      ? "/store"
      : me.role === "EMPLOYEE"
      ? "/rider"
      : "/cashier";
  const backLabel =
    me.role === "STORE_MANAGER"
      ? "Manager Dashboard"
      : me.role === "EMPLOYEE"
      ? "Rider Dashboard"
      : "Cashier Dashboard";
  const [userRow, categories, rawProducts] = await Promise.all([
    db.user.findUnique({
      where: { id: me.userId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            alias: true,
          },
        },
      },
    }),
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
        barcode: true,
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

  const employeeName = userRow?.employee
    ? `${userRow.employee.firstName ?? ""} ${userRow.employee.lastName ?? ""}`.trim()
    : "";
  const alias = userRow?.employee?.alias?.trim() ?? "";
  const assignedUser =
    alias && employeeName
      ? `${alias} (${employeeName})`
      : alias || employeeName || userRow?.email || `User #${me.userId}`;

  return json(
    { categories, products, backTo, backLabel, assignedUser, assignedRole: me.role },
    { headers: { "Cache-Control": "no-store" } },
  );
};

// ── kg helpers at file scope (no React deps) ───────────────────────────────
const SMALL_KG = [0.25, 0.5, 0.75] as const; // 1/4, 1/2, 3/4
function isKgRetail(
  prod: { unit?: { name?: string | null } | null },
  mode: "retail" | "pack",
) {
  return mode === "retail" && /kg/i.test(prod.unit?.name ?? "");
}

// Whole-kg add/sub: keep fractional part, step integers
const addWholeKg = (q: number) => q + 1;
const subWholeKg = (q: number) => q - 1;
const setFractionPart = (q: number, frac: 0 | 0.25 | 0.5 | 0.75) => {
  const i = Math.max(0, Math.floor(q));
  // if total was 0, allow pure fraction (¼/½/¾)
  return i === 0 ? frac : i + frac;
};

// ── category icon helper (emoji = zero-cost icons) ──────────
function catIcon(name?: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (/rice|bigas/.test(n)) return "🍚";
  if (/feed|sack|poultry|hog|animal/.test(n)) return "🐔";
  if (/snack|chips|biscuit|candy|sweet/.test(n)) return "🍪";
  if (/drink|beverage|juice|soft|soda/.test(n)) return "🥤";
  if (/water/.test(n)) return "🚰";
  if (/canned|can|tin|sardines|corned/.test(n)) return "🥫";
  if (/noodle|pasta|instant/.test(n)) return "🍜";
  if (/coffee|kopi|kape|tea/.test(n)) return "☕️";
  if (/oil|lard|butter/.test(n)) return "🫗";
  if (/sugar|asin|salt/.test(n)) return "🧂";
  if (/laundry|detergent|fabric|soap/.test(n)) return "🧼";
  if (/toilet|hygiene|toiletr|shampoo|bath/.test(n)) return "🧴";
  if (/frozen|meat|ice/.test(n)) return "🧊";
  if (/bread|bakery/.test(n)) return "🥖";
  if (/egg|itlog/.test(n)) return "🥚";
  if (/medicine|drug|vitamin|pharma/.test(n)) return "💊";
  // fallback: generic tag
  return "🏷️";
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function KioskPage() {
  const {
    categories,
    products,
    backTo,
    backLabel,
    assignedUser,
    assignedRole,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Local alias for the product item type coming from the loader
  type CategoryItem = (typeof categories)[number];
  type ProductItem = (typeof products)[number];

  // If you're on Remix v2, using a key gives you an isolated fetcher instance:
  // const createSlip = useFetcher<CreateSlipResp>({ key: "create-slip" });
  const createSlip =
    useFetcher<CreateSlipResp>() as ResettableFetcher<CreateSlipResp>;

  // Prevent re-handling the same success payload after rerenders/navigation
  const handledSuccessIdRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    // Remix v1 has no `reset`; Remix v2 does.
    // Call safely to avoid TS error and be a no-op on v1.
    createSlip.reset?.();
    handledSuccessIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useNavigate();
  const [printSlip, setPrintSlip] = React.useState(false);
  const [mobileCartOpen, setMobileCartOpen] = React.useState(false);

  // ── Fulfillment state (PICKUP / DELIVERY) + delivery fields ─────────────
  const [channel, setChannel] = React.useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [deliverTo, setDeliverTo] = React.useState("");
  const [deliverPhone, setDeliverPhone] = React.useState("");
  const [deliverLandmark, setDeliverLandmark] = React.useState("");
  const [deliverGeoLat, setDeliverGeoLat] = React.useState("");
  const [deliverGeoLng, setDeliverGeoLng] = React.useState("");
  const [deliverPhotoUrl, setDeliverPhotoUrl] = React.useState("");
  const [customerId, setCustomerId] = React.useState<number | null>(null);
  const [deliveryAddressId, setDeliveryAddressId] = React.useState<
    number | null
  >(null);
  const [selectedCustomer, setSelectedCustomer] =
    React.useState<PickedCustomer | null>(null);

  const {
    q: custQ,
    setQ: setCustQ,
    items: custItems,
    open: custOpen,
    setOpen: setCustOpen,
  } = useCustomerSearch({ withAddresses: true });
  type CustomerSearchItem = (typeof custItems)[number];
  const printLabel =
    channel === "DELIVERY"
      ? "Print ticket after create"
      : "Print slip after create";
  const createAndPrintCta =
    channel === "DELIVERY" ? "Create & Print Ticket" : "Create & Print Slip";

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

  // category edge-fade visibility
  const [catFadeL, setCatFadeL] = React.useState(false);
  const [catFadeR, setCatFadeR] = React.useState(true);

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p: ProductItem) => {
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

  // ── Scanner state ───────────────────────────────────────────
  const [scanOpen, setScanOpen] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const scanningRef = React.useRef(false);

  // Open scanner only on mobile (< md)
  const openScannerMobile = React.useCallback(() => {
    if (typeof window === "undefined") return; // SSR guard
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) return;
    setScanOpen(true);
  }, []);

  // Quick lookup by barcode
  const productByBarcode = React.useMemo(() => {
    const m = new Map<string, (typeof products)[number]>();
    for (const p of products) {
      const bc = String(p.barcode ?? "").trim();
      if (!bc) continue;
      // normalize: remove spaces to match scanner payloads
      const norm = bc.replace(/\s+/g, "");
      m.set(norm, p);
    }
    return m;
  }, [products]);

  const pickMode = React.useCallback(
    (p: (typeof products)[number]): Mode | null => {
      const price = Number(p.price ?? 0);
      const srp = Number(p.srp ?? 0);
      const retailStock = Number(p.packingStock ?? 0);
      const packStock = Number(p.stock ?? 0);
      if (p.allowPackSale && price > 0 && retailStock > 0) return "retail";
      if (srp > 0 && packStock > 0) return "pack";
      return null;
    },
    [],
  );

  // Pagination
  const [shown, setShown] = React.useState(20); // initial batch size

  // Reset page on filter/search change
  React.useEffect(() => {
    setShown(20);
  }, [q, activeCat, activeBrand]);

  // Monitor horizontal scroll of the category pill bar (mobile)
  React.useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard
    const scroller = document.getElementById("cat-scroll");
    if (!scroller) return;
    const update = () => {
      const atStart = scroller.scrollLeft <= 2;
      const atEnd =
        scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
      setCatFadeL(!atStart);
      setCatFadeR(!atEnd);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, []);

  // Mobile-only infinite scroll for product list (avoid TDZ on `total`)
  React.useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) return;
    const scroller = document.getElementById("product-scroll");
    if (!scroller) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const nearBottom =
          scroller.scrollTop + scroller.clientHeight >=
          scroller.scrollHeight - 200;
        if (nearBottom) {
          setShown((n) => Math.min(filtered.length, n + 50));
        }
        ticking = false;
      });
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [filtered.length, setShown]);

  const total = filtered.length;
  const pageItems = React.useMemo(
    () => filtered.slice(0, Math.min(total, shown)),
    [filtered, total, shown],
  );

  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // cart: id -> item snapshot

  type Mode = "retail" | "pack";
  type CartItem = {
    key: string;
    id: number;
    name: string;
    brandName?: string;
    mode: Mode;
    unitLabel: string;
    unitPrice: number;
    qty: number;
    step: number;
    isKg?: boolean;
  };
  const makeKey = (id: number, mode: Mode) => `${id}:${mode}`;

  // cart now keyed by id:mode

  const [cart, setCart] = useLocalStorageState<Record<string, CartItem>>(
    "op-cart",
    {},
  );

  // helper: get current cart line by product + mode
  const getCartLine = React.useCallback(
    (id: number, mode: Mode) => cart[`${id}:${mode}`] ?? null,
    [cart],
  );

  // stable helper to clear cart (and storage)
  const clearCart = React.useCallback(() => {
    setCart({});
    try {
      localStorage.removeItem("op-cart");
    } catch (_err) {
      // Intentionally ignore: storage might be unavailable (private mode)
      // or user denied access. Clearing cart state above is sufficient.
    }
  }, [setCart]);

  // ✅ Single reset function: prevents "old customer/name" carry-over after success
  const resetOrderPadState = React.useCallback(() => {
    // cart + storage
    clearCart();
    setMobileCartOpen(false);

    // search + filters
    setQ("");
    setActiveCat("");
    setActiveBrand("");

    // fulfillment state
    setChannel("PICKUP");
    setDeliverTo("");
    setDeliverPhone("");
    setDeliverLandmark("");
    setDeliverGeoLat("");
    setDeliverGeoLng("");
    setDeliverPhotoUrl("");
    setPrintSlip(false);

    // customer picker state
    setSelectedCustomer(null);
    setCustomerId(null);
    setDeliveryAddressId(null);
    setCustQ("");
    setCustOpen(false);

    // focus search after reset (safe: kiosk UX)
    const el =
      document.querySelector<HTMLInputElement>('input[name="search"]') ||
      searchRef.current;
    el?.focus();
  }, [
    clearCart,
    setQ,
    setActiveCat,
    setActiveBrand,
    setChannel,
    setDeliverTo,
    setDeliverPhone,
    setDeliverLandmark,
    setDeliverGeoLat,
    setDeliverGeoLng,
    setDeliverPhotoUrl,
    setPrintSlip,
    setSelectedCustomer,
    setCustomerId,
    setDeliveryAddressId,
    setCustQ,
    setCustOpen,
  ]);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  // derive brand options from current category (or all when no category)
  const brandOptions = React.useMemo(() => {
    const pool =
      activeCat === ""
        ? products
        : products.filter((p: ProductItem) => p.categoryId === activeCat);
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

  const add = React.useCallback(
    (p: (typeof products)[number], mode: Mode) => {
      const unitPrice = mode === "retail" ? Number(p.price) : Number(p.srp);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return;

      const kg = isKgRetail(p, mode);
      const step = kg ? 1 : mode === "retail" ? 0.25 : 1; // kg retail: step by 1 via +/- buttons
      const unitLabel =
        mode === "retail"
          ? p.unit?.name ?? "unit"
          : p.packingUnit?.name ?? "pack";
      const key = `${p.id}:${mode}`;

      setCart((prev) => {
        const ex = prev[key];
        // default add: kg starts at 1, else original behavior
        const nextQty = kg
          ? ex
            ? addWholeKg(ex.qty)
            : 1
          : +(ex ? ex.qty + step : step).toFixed(2);
        return {
          ...prev,
          [key]: {
            key,
            id: p.id,
            name: p.name,
            brandName: p.brand?.name ?? undefined,
            mode,
            unitLabel,
            unitPrice,
            qty: nextQty,
            step,
            isKg: kg,
          },
        };
      });
    },
    [setCart],
  );

  const inc = (key: string) =>
    setCart((prev) => {
      const ex = prev[key];
      if (!ex) return prev;
      const qty =
        ex.isKg && ex.mode === "retail"
          ? addWholeKg(ex.qty) // +1 kg, keep fraction
          : +(ex.qty + ex.step).toFixed(2); // original for others
      return { ...prev, [key]: { ...ex, qty } };
    });

  const dec = (key: string) =>
    setCart((prev) => {
      const ex = prev[key];
      if (!ex) return prev;
      const rawNext =
        ex.isKg && ex.mode === "retail"
          ? subWholeKg(ex.qty) // -1 kg, keep fraction
          : +(ex.qty - ex.step).toFixed(2);
      const next = Math.max(0, rawNext); // ⬅️ never below 0
      return { ...prev, [key]: { ...ex, qty: next } };
    });

  const setQty = (key: string, qty: number) =>
    setCart((prev) => {
      const ex = prev[key];
      if (!ex) return prev;
      let clamped: number;
      if (ex.isKg && ex.mode === "retail") {
        const safe = Math.max(0, Math.min(999, qty)); // allow 0
        const i = Math.floor(safe);
        const frac = safe - i;
        const choices = [0, ...SMALL_KG]; // 0, .25, .5, .75
        let best = 0,
          d = Infinity;
        for (const x of choices) {
          const dd = Math.abs(frac - x);
          if (dd < d) {
            d = dd;
            best = x;
          }
        }
        clamped = i + best;
      } else if (ex.mode === "retail") {
        // keep multiples of 0.25 for non-kg retail
        clamped = Math.max(ex.step, Math.min(999, Math.round(qty * 4) / 4));
      } else {
        clamped = Math.max(ex.step, Math.min(999, Math.round(qty)));
      }
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
    })),
  );

  // Handle fetcher response: navigate on success; show modal on 400
  React.useEffect(() => {
    if (createSlip.state !== "idle" || !createSlip.data) return;

    if (createSlip.data.ok === true) {
      const createdId = createSlip.data.id;

      // 🔒 Guard: don't handle the same success more than once
      if (handledSuccessIdRef.current === createdId) return;
      handledSuccessIdRef.current = createdId;

      const ch = createSlip.data.channel ?? channel;
      // ✅ Reset ALL relevant state after success (prevents old customer/name carry-over)
      // Note: compute `ch` first, then reset (so navigation uses correct channel)
      resetOrderPadState();
      if (printSlip) {
        const dest = ch === "DELIVERY" ? "ticket" : "slip";
        navigate(`/orders/${createdId}/${dest}?autoprint=1&autoback=1`, {
          replace: true,
        });
      } else {
        // No print → show code/QR for cashier
        setJustCreated({
          open: true,
          id: createdId,
          code: createSlip.data.orderCode,
        });
      }

      // 🧹 Reset fetcher so future renders don't see old success
      createSlip.reset?.(); // Remix v2; harmless no-op on v1
    } else {
      setClientErrors([]);
      setErrorOpen(true);
    }
  }, [
    createSlip.state,
    createSlip.data,
    createSlip,
    navigate,
    printSlip,
    channel,
    resetOrderPadState,
  ]);
  // header clock
  const [clock, setClock] = React.useState(() =>
    new Date().toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  );
  React.useEffect(() => {
    const id = setInterval(
      () =>
        setClock(
          new Date().toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        ),
      1000,
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
            t.isContentEditable)
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

  // Camera scanner lifecycle (open/close, start/stop stream, detect codes)
  React.useEffect(() => {
    // capture the current video node & stream for stable cleanup
    const videoEl = videoRef.current;
    let localStream: MediaStream | null = null;

    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;

    // Close / do nothing on desktop or when closed
    if (!scanOpen || isDesktop) {
      const s = (videoEl?.srcObject as MediaStream | null) ?? null;
      s?.getTracks().forEach((t) => t.stop());
      scanningRef.current = false;
      return;
    }

    async function startScanner() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (!videoEl) return;
        localStream = stream;
        videoEl.srcObject = stream;
        await videoEl.play();

        const Supported = !!window.BarcodeDetector;
        const formats = Supported
          ? await window.BarcodeDetector!.getSupportedFormats?.()
          : [];
        const detector = Supported
          ? new window.BarcodeDetector!({ formats })
          : null;

        scanningRef.current = true;
        let lastHit = 0;
        const loop = async () => {
          if (!scanningRef.current) return;
          if (detector && videoEl.readyState >= 2) {
            try {
              const codes = await detector.detect(videoEl);
              if (codes && codes.length > 0) {
                const now = Date.now();
                if (now - lastHit > 1200) {
                  lastHit = now;
                  const raw = String(codes[0].rawValue || "").trim();
                  const norm = raw.replace(/\s+/g, "");
                  const p = productByBarcode.get(norm);
                  if (p) {
                    const mode = pickMode(p);
                    if (mode) add(p, mode);
                    try {
                      navigator.vibrate?.(40);
                    } catch (_err) {
                      // Intentionally ignore: storage might be unavailable (private mode)
                      // or user denied access. Clearing cart state above is sufficient.
                    }
                    setScanOpen(false);
                    return;
                  }
                }
              }
            } catch {
              // Ignore transient detect errors (frame not ready, etc.)
              // Using a no-op statement to avoid 'no-empty' lint:
              void 0;
            }
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      } catch (err) {
        console.warn("Camera error:", err);
        alert("Camera not available or permission denied. Try manual search.");
        setScanOpen(false);
      }
    }
    startScanner();
    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      scanningRef.current = false;
    };
    // keep deps minimal; memoize helpers below
  }, [scanOpen, productByBarcode, add, pickMode]);

  // ── UI helpers for nicer buttons ──────────────────────────
  // ✅ keep these names; only classes updated
  const btnBase =
    "inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-sm transition shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200";

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
        // qty must be a multiple of 0.25 → check in quarters (robust integer math)
        if (!Number.isInteger(Math.round(line.qty * 4))) {
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
    const errs = validateCartForSubmit();
    if (errs.length) {
      e.preventDefault();
      setClientErrors(errs);
      setErrorOpen(true);
      return; // importante: stop here
    }

    // EXTRA: delivery checks
    if (channel === "DELIVERY") {
      if (!deliverTo.trim()) {
        e.preventDefault();
        alert("Please enter 'Deliver To' before creating a Delivery order.");
        return;
      }
      // optional pero helpful: lat/lng must be both filled or both blank
      const lat = deliverGeoLat.trim();
      const lng = deliverGeoLng.trim();
      if ((lat && !lng) || (!lat && lng)) {
        e.preventDefault();
        alert("Set BOTH latitude and longitude, or leave BOTH blank.");
        return;
      }
    }

    // ok to submit
    setClientErrors([]);
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="Order Pad Workspace"
        subtitle={`Build pickup or delivery orders from one live catalog. Assigned: ${assignedUser} (${assignedRole})`}
        backTo={backTo}
        backLabel={backLabel}
        maxWidthClassName="max-w-[1760px]"
      />
      <section className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-end gap-2 px-5 py-3">
          <span className="text-xs tabular-nums text-slate-600" aria-label="clock">
            {clock}
          </span>
          <SoTButton
            type="button"
            variant="secondary"
            onClick={resetOrderPadState}
            title="Start a fresh cart"
          >
            New Order
          </SoTButton>
          <SoTButton type="button" variant="danger" onClick={clearCart}>
            Clear Cart
          </SoTButton>
          <Form method="post" action="/logout">
            <SoTButton type="submit" variant="secondary" title="Sign out">
              Logout
            </SoTButton>
          </Form>
        </div>
      </section>
      <div className="mx-auto w-full max-w-[1760px] grid grid-cols-1 items-start gap-4 overflow-x-hidden p-0 pb-20 md:grid-cols-[240px_minmax(0,1fr)_380px] md:p-4 md:pb-4">

      {/* Top controls (mobile only): chips + search */}
      <div className="md:hidden flex flex-col gap-3 px-4">
        {/* Compact scrollable pill bar with smart fades */}
        <div className="relative">
          {/* left fade (hidden at start) */}
          <div
            className={`pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-[#f7f7fb] to-transparent transition-opacity ${
              catFadeL ? "opacity-100" : "opacity-0"
            }`}
          />
          {/* right fade (hidden at end) */}
          <div
            className={`pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-[#f7f7fb] to-transparent transition-opacity ${
              catFadeR ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            id="cat-scroll"
            className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth px-3 py-1"
          >
            <button
              onClick={() => setActiveCat("")}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] ${
                activeCat === ""
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
            >
              <span>✨</span>
              <span className="font-medium">All</span>
            </button>
            {categories.map((c: CategoryItem) => {
              const selected = activeCat === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCat(c.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] ${
                    selected
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
                  title={c.name}
                >
                  <span className="text-[14px] leading-none">
                    {catIcon(c.name)}
                  </span>
                  <span className="font-medium max-w-[10ch] truncate">
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            ref={searchRef}
            name="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
          />
          <button
            type="button"
            onClick={openScannerMobile}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            title="Scan barcode"
          >
            📷
          </button>
        </div>
      </div>

      {/* LEFT: Sticky category sidebar (tablet/desktop) */}
      <aside className="hidden md:block sticky top-4 self-start">
        <SoTCard className="max-h-[calc(100vh-7rem)] overflow-auto p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Categories
          </div>
          <div className="flex flex-col gap-2">
            <button
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                activeCat === ""
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
              onClick={() => setActiveCat("")}
            >
              All
            </button>
            {categories.map((c: CategoryItem) => (
              <button
                key={c.id}
                className={`rounded-xl border px-3 py-2 text-left text-sm ${
                  activeCat === c.id
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
                onClick={() => setActiveCat(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </SoTCard>
      </aside>

      {/* Product grid */}
      <section>
        <SoTCard className="overflow-hidden p-3 md:p-4">
        {/* Search (tablet/desktop) */}
        <div className="hidden md:flex gap-2 mb-3 items-end">
          <div className="flex-1">
            <TextInput
              label="Search"
              name="search"
              placeholder="🔍 Search products…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white shadow-sm focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
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

        {total === 0 ? (
          <div className="text-sm text-slate-500">No results.</div>
        ) : (
          <div
            id="product-scroll"
            className="overflow-y-auto pr-1"
            style={{ maxHeight: "calc(100vh - 14rem)" }}
          >
            {/* Sticky list header INSIDE the scroller for proper separation */}
            <div className="sticky top-0 z-10 -mx-3 md:-mx-4 px-3 md:px-4 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
              <div className="h-10 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-slate-800">Products</h2>
                <div className="hidden md:block text-sm text-slate-600">
                  Showing{" "}
                  <span className="font-medium">{pageItems.length}</span> of{" "}
                  <span className="font-medium">{total}</span>
                </div>
              </div>
            </div>
            <div className="space-y-2 pt-2">
              {pageItems.map((p: ProductItem) => {
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

                // NEW (for mobile controls): default mode & current line
                const defaultMode = pickMode(p); // "retail" | "pack" | null
                const currentLine = defaultMode
                  ? getCartLine(p.id, defaultMode)
                  : null;

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
                            <span
                              className="flex-none text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200"
                              title={`Product ID: ${p.id}`}
                            >
                              #{p.id}
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
                        {/* DESKTOP/TABLET: full original Add logic */}
                        <div className="hidden md:flex flex-col items-end gap-1">
                          {p.allowPackSale ? (
                            <>
                              {/* Retail Add */}
                              {(() => {
                                const inCartRetail = Boolean(
                                  cart[makeKey(p.id, "retail")],
                                );
                                const retailOk =
                                  retailStock > 0 && Number(p.price) > 0;
                                const disabled = inCartRetail || !retailOk;
                                const title = inCartRetail
                                  ? "Already in cart (retail)"
                                  : !retailOk
                                  ? "Retail unavailable (no stock/price)"
                                  : `Add by ${unit} at ${peso(
                                      Number(p.price),
                                    )}`;
                                return (
                                  <button
                                    onClick={() => add(p, "retail")}
                                    disabled={disabled}
                                    title={title}
                                    className={`${btnBase} ${
                                      disabled ? btnDisabled : btnOutline
                                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
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

                              {/* Quick fractions for kg retail (create line from 0 + fraction) */}
                              {(() => {
                                const kgRetail = /kg/i.test(p.unit?.name ?? "");
                                if (!kgRetail || !retailAvailable) return null;
                                const inCartRetail = Boolean(
                                  cart[makeKey(p.id, "retail")],
                                );
                                const addWithQty = (qty: 0.25 | 0.5 | 0.75) => {
                                  const key = makeKey(p.id, "retail");
                                  setCart((prev) => ({
                                    ...prev,
                                    [key]: {
                                      key,
                                      id: p.id,
                                      name: p.name,
                                      brandName: p.brand?.name ?? undefined,
                                      mode: "retail",
                                      unitLabel: p.unit?.name ?? "kg",
                                      unitPrice: Number(p.price),
                                      qty,
                                      step: 1, // ± buttons = whole kg
                                      isKg: true,
                                    },
                                  }));
                                };
                                return inCartRetail ? null : (
                                  <div className="mt-1 flex gap-1">
                                    {[0.25, 0.5, 0.75].map((f) => (
                                      <button
                                        key={f}
                                        onClick={() =>
                                          addWithQty(f as 0.25 | 0.5 | 0.75)
                                        }
                                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                        title={`Add ${f} kg`}
                                      >
                                        {f === 0.25
                                          ? "¼"
                                          : f === 0.5
                                          ? "½"
                                          : "¾"}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}

                              {/* Pack Add */}
                              {(() => {
                                const inCartPack = Boolean(
                                  cart[makeKey(p.id, "pack")],
                                );
                                const packOk =
                                  packStock > 0 && Number(p.srp) > 0;
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
                                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
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
                                cart[makeKey(p.id, "pack")],
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
                                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
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

                        {/* MOBILE: if in cart → show stepper; else small Add buttons */}
                        <div className="md:hidden flex flex-col items-end gap-1">
                          {!defaultMode ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200">
                              Unavailable
                            </span>
                          ) : currentLine ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => dec(currentLine.key)}
                                className="px-3 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                aria-label="Decrease"
                              >
                                −
                              </button>
                              <div className="w-16 h-9 grid place-items-center rounded-lg border border-slate-300 bg-white">
                                <span className="font-mono text-sm tabular-nums">
                                  {currentLine.qty}
                                </span>
                              </div>
                              <button
                                onClick={() => inc(currentLine.key)}
                                className="px-3 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                aria-label="Increase"
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              {retailAvailable && (
                                <button
                                  onClick={() => add(p, "retail")}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs shadow-sm active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  title={`Add by ${unit}`}
                                >
                                  + {unit}
                                </button>
                              )}
                              {packAvailable && (
                                <button
                                  onClick={() => add(p, "pack")}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs shadow-sm active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  title={`Add ${packUnit}`}
                                >
                                  + {packUnit}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {pageItems.length < total ? (
              <div className="hidden md:block pt-2">
                <button
                  onClick={() => setShown((n) => Math.min(total, n + 50))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Load more ({total - pageItems.length} left)
                </button>
              </div>
            ) : null}
          </div>
        )}
        </SoTCard>
      </section>

      {/* Cart panel */}
      <aside className="hidden md:block sticky top-4 self-start">
        <SoTCard className="h-fit overflow-hidden bg-white/95 p-0 backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            🧾 <span>Order List</span>
            <span
              className="ml-1 inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200"
              title="Lines in cart"
            >
              {Object.keys(cart).length}
            </span>
          </h2>
          <button
            onClick={() => {
              clearCart();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            disabled={items.length === 0}
          >
            <span>Clear</span>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            <div className="mx-auto mb-2 h-10 w-10 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 flex items-center justify-center">
              🛒
            </div>
            Order is empty.
          </div>
        ) : (
          <>
            {/* Lines */}
            <div className="max-h-[50vh] overflow-auto custom-scrollbar">
              <ul className="divide-y divide-slate-200">
                {items.map((it) => (
                  <li key={it.key} className="px-4 py-3">
                    {/* Two-row responsive layout: top = title + total, bottom = meta + controls */}
                    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-start">
                      {/* Title (larger, wraps up to 2 lines) */}
                      <div className="min-w-0 col-span-1">
                        <div className="min-w-0">
                          <span
                            className="block text-base font-semibold leading-snug text-slate-900 break-words whitespace-normal"
                            title={it.name}
                          >
                            {it.name}
                          </span>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-600 min-w-0">
                            <span className="font-mono text-[11px] text-slate-500">
                              #{it.id}
                            </span>
                            {it.brandName ? (
                              <span className="truncate">{it.brandName}</span>
                            ) : null}
                            <span className="text-[10px] uppercase text-slate-500">
                              [{it.mode}]
                            </span>
                          </div>
                          {/* Moved unit-price caption here for consistent readability */}
                          <div className="mt-0.5 text-xs text-slate-600">
                            {it.qty} × {peso(it.unitPrice)}
                            {it.mode === "retail" ? ` /${it.unitLabel}` : ""}
                          </div>
                        </div>
                      </div>
                      {/* Line total (top-right) */}
                      <div className="col-span-1 text-right font-semibold text-slate-900">
                        {peso(it.qty * it.unitPrice)}
                      </div>

                      {/* Controls (bottom-right) */}
                      <div className="col-span-1 flex items-center justify-end gap-2">
                        {it.isKg && it.mode === "retail" ? (
                          <>
                            {/* Stepper: ±1kg, center shows value (no input spinners) */}
                            <div className="flex items-center rounded-lg border border-slate-200 bg-white h-9">
                              <button
                                onClick={() => dec(it.key)}
                                className="px-2 h-9 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                aria-label="Decrease 1 kg"
                              >
                                −
                              </button>
                              <div className="w-16 text-center font-mono text-sm tabular-nums">
                                {it.qty}
                              </div>
                              <button
                                onClick={() => inc(it.key)}
                                className="px-2 h-9 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                aria-label="Increase 1 kg"
                              >
                                +
                              </button>
                            </div>
                            {/* Fractions segmented control — always horizontal, scroll if needed */}
                            <div className="inline-flex rounded-lg border border-slate-200 max-w-[220px] overflow-x-auto whitespace-nowrap no-scrollbar">
                              {[0.25, 0.5, 0.75].map((f) => (
                                <button
                                  key={f}
                                  onClick={() =>
                                    setCart((p) => ({
                                      ...p,
                                      [it.key]: {
                                        ...it,
                                        qty: setFractionPart(
                                          it.qty,
                                          f as 0 | 0.25 | 0.5 | 0.75,
                                        ),
                                      },
                                    }))
                                  }
                                  className="px-2 h-9 text-xs bg-white hover:bg-slate-50 border-l first:border-l-0 border-slate-200 inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  title={`Set fraction to ${f} kg`}
                                >
                                  {f === 0.25 ? "¼" : f === 0.5 ? "½" : "¾"}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Non-kg: keep compact number input + ± */}
                            <button
                              onClick={() => dec(it.key)}
                              className="px-2 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                              aria-label="Decrease"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              inputMode="decimal"
                              step={it.step}
                              min={it.step}
                              max={999}
                              value={it.qty}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "" || v === "-" || v === ".") return;
                                setQty(it.key, Number(v));
                              }}
                              className="w-20 h-9 text-sm rounded-lg border border-slate-300 bg-white px-2 text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                            />
                            <button
                              onClick={() => inc(it.key)}
                              className="px-2 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                              aria-label="Increase"
                            >
                              +
                            </button>
                          </>
                        )}
                        <button
                          onClick={() =>
                            setCart((p) => {
                              const c = { ...p };
                              delete c[it.key];
                              return c;
                            })
                          }
                          className="ml-1 px-2 h-9 rounded-lg border border-red-100 bg-white text-sm text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                          aria-label="Remove line"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Subtotal */}
            <div className="px-4 py-3 border-t border-slate-200 bg-white/80 backdrop-blur">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-600">Subtotal</div>
                <div className="font-semibold text-slate-900">
                  {peso(subtotal)}
                </div>
              </div>
            </div>
            {/* Fulfillment */}
            <div className="px-4 pt-3">
              <div className="text-sm font-medium text-slate-800 mb-2">
                Customer
              </div>
              {/* Customer picker (works for PICKUP + DELIVERY) */}
              <div className="rounded-xl border border-slate-200 p-2">
                <div className="text-xs text-slate-600 mb-1">
                  Optional for walk-in. Piliin lang kung kilala / may discount.
                </div>

                {/* Input (shared hook) */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SoTInput
                      value={
                        selectedCustomer
                          ? `${selectedCustomer.firstName}${
                              selectedCustomer.middleName
                                ? " " + selectedCustomer.middleName
                                : ""
                            } ${selectedCustomer.lastName}${
                              selectedCustomer.phone
                                ? " • " + selectedCustomer.phone
                                : ""
                            }`
                          : custQ
                      }
                      onChange={(e) => {
                        setSelectedCustomer(null);
                        setCustomerId(null);
                        setDeliveryAddressId(null);
                        setCustQ(e.target.value);
                        setCustOpen(Boolean(e.target.value.trim()));
                      }}
                      onFocus={() => custQ.trim() && setCustOpen(true)}
                      placeholder="09xx… / name / alias"
                    />
                  </div>
                  {selectedCustomer ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerId(null);
                        setDeliveryAddressId(null);
                        setCustQ("");
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                {/* Results dropdown */}
                {custOpen && !selectedCustomer && custQ.trim() ? (
                  <div className="mt-2 max-h-56 overflow-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {custItems.length > 0 ? (
                      custItems.map((h: CustomerSearchItem) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => {
                            const picked = h as PickedCustomer;
                            setSelectedCustomer(picked);
                            setCustomerId(h.id);

                            // Only prefill delivery fields when DELIVERY (avoid mixing walk-in)
                            if (channel === "DELIVERY") {
                              const name = `${h.firstName}${
                                h.middleName ? " " + h.middleName : ""
                              } ${h.lastName}`.trim();
                              const addr = picked.addresses?.[0] || null;
                              const addrText = addr
                                ? `${addr.line1 ?? ""}${
                                    addr.barangay ? ", " + addr.barangay : ""
                                  }${addr.city ? ", " + addr.city : ""}${
                                    addr.province ? ", " + addr.province : ""
                                  }`.replace(/^, /, "")
                                : "";
                              setDeliverTo(
                                addr ? `${name} — ${addrText}` : name,
                              );
                              if (h.phone) setDeliverPhone(h.phone);
                            }

                            setCustQ("");
                            setCustOpen(false);
                          }}
                          className="w-full text-left px-2 py-2 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        >
                          <div className="text-sm text-slate-900">
                            {h.firstName} {h.middleName || ""} {h.lastName}{" "}
                            {h.alias ? `(${h.alias})` : ""}
                          </div>
                          <div className="text-xs text-slate-600">
                            {h.phone || "—"}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-2 py-2 text-sm text-slate-600">
                        No results.
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Address select ONLY for DELIVERY */}
                {channel === "DELIVERY" &&
                selectedCustomer?.addresses?.length ? (
                  <div className="mt-2">
                    <label
                      htmlFor="delivery-address-id"
                      className="block text-xs text-slate-600"
                    >
                      Address
                    </label>
                    <SelectInput
                      name="deliveryAddressId"
                      value={deliveryAddressId ?? ""}
                      onChange={(value) =>
                        setDeliveryAddressId(
                          String(value) ? Number(value) : null,
                        )
                      }
                      className="mt-1"
                      options={[
                        { label: "— None / custom —", value: "" },
                        ...selectedCustomer.addresses.map((a) => ({
                          label:
                            (a.label ? `${a.label}: ` : "") +
                            [a.line1, a.barangay, a.city].filter(Boolean).join(", "),
                          value: String(a.id),
                        })),
                      ]}
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-3 text-sm font-medium text-slate-800 mb-2">
                Fulfillment
              </div>
              <div className="flex items-center gap-3 text-sm">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    checked={channel === "PICKUP"}
                    onChange={() => setChannel("PICKUP")}
                  />
                  <span>Pick-up</span>
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    checked={channel === "DELIVERY"}
                    onChange={() => setChannel("DELIVERY")}
                  />
                  <span>Delivery</span>
                </label>
              </div>

              {channel === "DELIVERY" && (
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <SoTInput
                    label="Deliver To (name — full address) *"
                    value={deliverTo}
                    onChange={(e) => setDeliverTo(e.target.value)}
                    placeholder="Juan Dela Cruz — #123 Purok 1, Brgy. Sample, City"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <SoTInput
                      label="Phone (optional)"
                      value={deliverPhone}
                      onChange={(e) => setDeliverPhone(e.target.value)}
                      placeholder="09xx xxx xxxx"
                    />
                    <SoTInput
                      label="Landmark (optional)"
                      value={deliverLandmark}
                      onChange={(e) => setDeliverLandmark(e.target.value)}
                      placeholder="Near barangay hall"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <SoTInput
                      label="Latitude (optional)"
                      value={deliverGeoLat}
                      onChange={(e) => setDeliverGeoLat(e.target.value)}
                      placeholder="14.5995"
                      inputMode="decimal"
                    />
                    <SoTInput
                      label="Longitude (optional)"
                      value={deliverGeoLng}
                      onChange={(e) => setDeliverGeoLng(e.target.value)}
                      placeholder="120.9842"
                      inputMode="decimal"
                    />
                  </div>
                  <SoTInput
                    label="Photo URL (optional)"
                    value={deliverPhotoUrl}
                    onChange={(e) => setDeliverPhotoUrl(e.target.value)}
                    placeholder="https://..."
                  />
                  <div className="text-[11px] text-slate-500">
                    If you set either latitude or longitude, set both (server
                    validates).
                  </div>
                </div>
              )}

              <div className="mt-3">
                <SoTAlert
                  tone={channel === "DELIVERY" ? "info" : "warning"}
                  title="Print Artifact"
                >
                  {channel === "DELIVERY"
                    ? "Delivery orders print an Order Ticket for rider handoff and map routing."
                    : "Pickup orders print an Order Slip for cashier order reference."}
                </SoTAlert>
              </div>
            </div>

            {/* Actions */}
            <div className="px-4 pb-4">
              <createSlip.Form
                method="post"
                action="/orders/new?respond=json"
                className="mt-2"
                onSubmit={handleCreateSubmit}
              >
                <input type="hidden" name="items" value={payload} />
                <input type="hidden" name="terminalId" value="KIOSK-01" />
                {/* carry customer linkage (single source) */}
                <input
                  type="hidden"
                  name="customerId"
                  value={customerId ?? ""}
                />
                <input
                  type="hidden"
                  name="deliveryAddressId"
                  value={deliveryAddressId ?? ""}
                />
                {/* NEW: fulfillment + delivery fields */}
                <input type="hidden" name="channel" value={channel} />
                {channel === "DELIVERY" && (
                  <>
                    <input name="deliverTo" value={deliverTo} readOnly hidden />
                    <input
                      name="deliverPhone"
                      value={deliverPhone}
                      readOnly
                      hidden
                    />
                    <input
                      name="deliverLandmark"
                      value={deliverLandmark}
                      readOnly
                      hidden
                    />
                    <input
                      name="deliverGeoLat"
                      value={deliverGeoLat}
                      readOnly
                      hidden
                    />
                    <input
                      name="deliverGeoLng"
                      value={deliverGeoLng}
                      readOnly
                      hidden
                    />
                    <input
                      name="deliverPhotoUrl"
                      value={deliverPhotoUrl}
                      readOnly
                      hidden
                    />
                  </>
                )}
                <label className="mb-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    checked={printSlip}
                    onChange={(e) => setPrintSlip(e.target.checked)}
                  />
                  <span>{printLabel}</span>
                </label>
                <button
                  className="mt-2 w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  disabled={
                    items.length === 0 ||
                    createSlip.state !== "idle" ||
                    (channel === "DELIVERY" && !deliverTo.trim())
                  }
                  title={
                    channel === "DELIVERY" && !deliverTo.trim()
                      ? "Enter Deliver To"
                      : undefined
                  }
                >
                  {createSlip.state !== "idle"
                    ? "Creating…"
                    : printSlip
                    ? createAndPrintCta
                    : "Create Order"}
                </button>
              </createSlip.Form>
            </div>
          </>
        )}
        </SoTCard>
      </aside>

      {/* FOOTER */}
      <footer className="md:col-span-3 text-xs text-slate-600 border-t border-slate-200 pt-2 mt-2 px-4">
        Tips: <kbd>/</kbd> focus search • <kbd>+</kbd>/<kbd>−</kbd> adjust qty •
        Low stock badge legend coming next • v0.1
      </footer>
      </div>

      {/* CAMERA SCANNER */}
      {scanOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 z-50 grid place-items-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            onClick={() => setScanOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden bg-black shadow-lg">
            <video
              ref={videoRef}
              className="w-full h-[380px] object-cover"
              playsInline
              muted
            />
            {/* framing guide */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="w-64 h-24 rounded-lg ring-2 ring-white/90"></div>
            </div>
            <button
              onClick={() => setScanOpen(false)}
              className="absolute top-2 right-2 rounded-xl bg-white/90 px-2 py-1 text-sm text-slate-800 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

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
            className="absolute inset-0 bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
                    justCreated.code,
                  )}`}
                />
              ) : null}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setJustCreated({ open: false })}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
            className="absolute inset-0 bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MOBILE CART SHEET */}
      {mobileCartOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 z-50"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close cart"
            className="absolute inset-0 bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            onClick={() => setMobileCartOpen(false)}
          />
          {/* Sheet */}
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl bg-white shadow-2xl border-t border-slate-200 flex flex-col">
            {/* Grabber */}
            <div className="pt-2 pb-1 flex justify-center">
              <div className="h-1.5 w-10 rounded-full bg-slate-300" />
            </div>
            {/* Header */}
            <div className="px-4 pb-2 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">
                Cart ({items.length})
              </h3>
              <button
                onClick={() => {
                  clearCart();
                }}
                className="text-xs px-2 py-1 rounded-lg border border-red-100 text-red-600 bg-white hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Clear
              </button>
            </div>

            {/* Lines */}
            <div className="flex-1 overflow-auto">
              <ul className="divide-y divide-slate-200">
                {items.map((it) => (
                  <li key={it.key} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: name + meta */}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 line-clamp-2 break-words">
                          {it.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-600">
                          <span className="font-mono text-[10px] text-slate-500">
                            #{it.id}
                          </span>
                          {it.brandName ? (
                            <span className="truncate">{it.brandName}</span>
                          ) : null}
                          <span className="uppercase text-[10px] text-slate-500">
                            [{it.mode}]
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-600">
                          {it.qty} × {peso(it.unitPrice)}
                          {it.mode === "retail" ? ` /${it.unitLabel}` : ""}
                        </div>
                      </div>

                      {/* Right: total */}
                      <div className="text-right text-sm font-semibold text-slate-900 whitespace-nowrap">
                        {peso(it.qty * it.unitPrice)}
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {/* qty controls */}
                      {it.isKg && it.mode === "retail" ? (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center rounded-lg border border-slate-200 bg-white h-9">
                            <button
                              onClick={() => dec(it.key)}
                              className="px-3 h-9 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                              aria-label="Decrease 1 kg"
                            >
                              −
                            </button>
                            <div className="w-16 text-center font-mono text-sm tabular-nums">
                              {it.qty}
                            </div>
                            <button
                              onClick={() => inc(it.key)}
                              className="px-3 h-9 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                              aria-label="Increase 1 kg"
                            >
                              +
                            </button>
                          </div>
                          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                            {[0.25, 0.5, 0.75].map((f) => (
                              <button
                                key={f}
                                onClick={() =>
                                  setCart((p) => ({
                                    ...p,
                                    [it.key]: {
                                      ...it,
                                      qty: setFractionPart(
                                        it.qty,
                                        f as 0 | 0.25 | 0.5 | 0.75,
                                      ),
                                    },
                                  }))
                                }
                                className="px-2 h-9 text-xs bg-white hover:bg-slate-50 border-l first:border-l-0 border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                title={`Set fraction ${f} kg`}
                              >
                                {f === 0.25 ? "¼" : f === 0.5 ? "½" : "¾"}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => dec(it.key)}
                            className="px-3 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            aria-label="Decrease"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            inputMode="decimal"
                            step={it.step}
                            min={it.step}
                            max={999}
                            value={it.qty}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "" || v === "-" || v === ".") return;
                              setQty(it.key, Number(v));
                            }}
                            className="w-20 h-9 text-sm rounded-lg border border-slate-300 bg-white px-2 text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                          />
                          <button
                            onClick={() => inc(it.key)}
                            className="px-3 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            aria-label="Increase"
                          >
                            +
                          </button>
                        </div>
                      )}

                      <button
                        onClick={() =>
                          setCart((p) => {
                            const c = { ...p };
                            delete c[it.key];
                            return c;
                          })
                        }
                        className="ml-auto px-3 h-9 rounded-lg border border-red-100 bg-white text-sm text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        aria-label="Remove line"
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Footer total & actions */}
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-600">Subtotal</div>
                <div className="font-semibold text-slate-900">
                  {peso(subtotal)}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMobileCartOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white text-sm text-slate-800 px-3 py-2 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Continue
                </button>
                <createSlip.Form
                  method="post"
                  action="/orders/new?respond=json"
                  onSubmit={handleCreateSubmit}
                >
                  <input type="hidden" name="items" value={payload} />
                  <input type="hidden" name="terminalId" value="KIOSK-01" />
                  <input
                    type="hidden"
                    name="customerId"
                    value={customerId ?? ""}
                  />
                  <input
                    type="hidden"
                    name="deliveryAddressId"
                    value={deliveryAddressId ?? ""}
                  />
                  <input type="hidden" name="channel" value={channel} />
                  {channel === "DELIVERY" && (
                    <>
                      <input
                        name="deliverTo"
                        value={deliverTo}
                        readOnly
                        hidden
                      />
                      <input
                        name="deliverPhone"
                        value={deliverPhone}
                        readOnly
                        hidden
                      />
                      <input
                        name="deliverLandmark"
                        value={deliverLandmark}
                        readOnly
                        hidden
                      />
                      <input
                        name="deliverGeoLat"
                        value={deliverGeoLat}
                        readOnly
                        hidden
                      />
                      <input
                        name="deliverGeoLng"
                        value={deliverGeoLng}
                        readOnly
                        hidden
                      />
                      <input
                        name="deliverPhotoUrl"
                        value={deliverPhotoUrl}
                        readOnly
                        hidden
                      />
                    </>
                  )}
                  <button
                    className="w-full rounded-xl bg-indigo-600 text-white text-sm font-medium px-3 py-2 shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    disabled={
                      items.length === 0 ||
                      createSlip.state !== "idle" ||
                      (channel === "DELIVERY" && !deliverTo.trim())
                    }
                    title={
                      channel === "DELIVERY" && !deliverTo.trim()
                        ? "Open Cart and fill delivery details"
                        : undefined
                    }
                  >
                    {createSlip.state !== "idle" ? "Creating…" : "Create Order"}
                  </button>
                </createSlip.Form>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MOBILE BOTTOM BAR */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            className="flex-1 inline-flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            title="View cart"
          >
            <span className="font-medium">View Cart</span>
            <span className="text-xs text-slate-600">
              {Object.keys(cart).length} line
              {Object.keys(cart).length === 1 ? "" : "s"} • {peso(subtotal)}
            </span>
          </button>

          <createSlip.Form
            method="post"
            action="/orders/new?respond=json"
            onSubmit={handleCreateSubmit}
            className="flex-1"
          >
            <input type="hidden" name="items" value={payload} />
            <input type="hidden" name="terminalId" value="KIOSK-01" />
            <input type="hidden" name="customerId" value={customerId ?? ""} />
            <input
              type="hidden"
              name="deliveryAddressId"
              value={deliveryAddressId ?? ""}
            />
            <input type="hidden" name="channel" value={channel} />
            {channel === "DELIVERY" && (
              <>
                <input name="deliverTo" value={deliverTo} readOnly hidden />
                <input
                  name="deliverPhone"
                  value={deliverPhone}
                  readOnly
                  hidden
                />
                <input
                  name="deliverLandmark"
                  value={deliverLandmark}
                  readOnly
                  hidden
                />
                <input
                  name="deliverGeoLat"
                  value={deliverGeoLat}
                  readOnly
                  hidden
                />
                <input
                  name="deliverGeoLng"
                  value={deliverGeoLng}
                  readOnly
                  hidden
                />
                <input
                  name="deliverPhotoUrl"
                  value={deliverPhotoUrl}
                  readOnly
                  hidden
                />
              </>
            )}
            <button
              className="w-full rounded-xl bg-indigo-600 text-white text-sm font-medium px-3 py-2 shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              disabled={
                items.length === 0 ||
                createSlip.state !== "idle" ||
                (channel === "DELIVERY" && !deliverTo.trim())
              }
              title={
                channel === "DELIVERY" && !deliverTo.trim()
                  ? "Open cart and fill delivery details"
                  : undefined
              }
            >
              {createSlip.state !== "idle" ? "Creating…" : "Create"}
            </button>
          </createSlip.Form>
        </div>
      </div>
    </main>
  );
}
