import { Link, useFetcher } from "@remix-run/react";
import { clsx } from "clsx";
import { memo, useEffect, useState } from "react";
import {
  SoTTable,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
import type { ProductWithDetails } from "~/types";

type ProductsListTableProps = {
  products: ProductWithDetails[];
  highlightId?: number | null;
  actionFetcher: ReturnType<typeof useFetcher>;
};

type PendingState = {
  kind: "toggle" | null;
  id: number | null;
};

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pluralize(word: string) {
  return word && !word.endsWith("s") ? `${word}s` : word;
}

function ProductsListTableBase({
  products,
  highlightId,
  actionFetcher,
}: ProductsListTableProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 640px)").matches;
  });

  const [pending, setPending] = useState<PendingState>({
    kind: null,
    id: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(media.matches);
    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (actionFetcher.state === "idle" && pending.kind === "toggle") {
      setPending({ kind: null, id: null });
    }
  }, [actionFetcher.state, pending.kind]);

  const isTogglePending = (id: number) =>
    pending.kind === "toggle" && pending.id === id;

  function submitToggle(product: ProductWithDetails) {
    if (pending.kind) return;
    const form = new FormData();
    form.append("toggleId", String(product.id));
    form.append("isActive", String(!product.isActive));
    setPending({ kind: "toggle", id: product.id });
    actionFetcher.submit(form, { method: "post" });
  }

  if (isDesktop) {
    return (
      <div>
        <SoTTable
          className="min-w-full"
          containerClassName="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <SoTTableHead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-slate-600">
            <SoTTableRow className="border-t-0 text-xs uppercase tracking-wide text-slate-600">
              <SoTTh className="hidden sm:table-cell">ID</SoTTh>
              <SoTTh>Name (Brand)</SoTTh>
              <SoTTh className="hidden md:table-cell">Category</SoTTh>
              <SoTTh className="hidden lg:table-cell">Packaging</SoTTh>
              <SoTTh>Pricing</SoTTh>
              <SoTTh>Stock</SoTTh>
              <SoTTh align="center" className="hidden sm:table-cell">
                Active?
              </SoTTh>
              <SoTTh align="center">Actions</SoTTh>
            </SoTTableRow>
          </SoTTableHead>

          <tbody>
            <SoTTableRow className="h-0 border-0">
              <SoTTd colSpan={8} className="py-0">
                <div id="table-anchor" className="scroll-mt-24" />
              </SoTTd>
            </SoTTableRow>

            {products.map((product, index) => {
              const packingSizeNum = asNumber(product.packingSize);
              const srpNum = asNumber(product.srp);
              const priceNum = asNumber(product.price);
              const stockNum = asNumber(product.stock);
              const minStockNum = asNumber(product.minStock);
              const packingStockNum = asNumber(product.packingStock);

              const packLabel =
                packingSizeNum != null &&
                packingSizeNum > 0 &&
                product.unitName &&
                product.packingUnitName
                  ? `${packingSizeNum} ${pluralize(product.unitName)} / ${
                      product.packingUnitName
                    }`
                  : "—";

              const isLowStock =
                stockNum != null &&
                minStockNum != null &&
                stockNum < minStockNum;

              return (
                <SoTTableRow
                  key={product.id}
                  className={clsx(
                    "cursor-default transition-colors",
                    "hover:bg-slate-50",
                    index % 2 === 0 && "bg-slate-50/30",
                    product.id === highlightId && "ring-1 ring-emerald-300",
                    isLowStock && "bg-rose-50/70"
                  )}
                  style={
                    product.id === highlightId
                      ? { backgroundColor: "#d1fae5" }
                      : undefined
                  }
                >
                  <SoTTd className="hidden font-mono tabular-nums text-slate-600 sm:table-cell">
                    {product.id}
                  </SoTTd>

                  <SoTTd className="max-w-[220px] text-slate-900">
                    <div className="flex flex-col overflow-hidden">
                      <Link
                        to={`/products/${product.id}`}
                        className="truncate text-sm font-semibold text-indigo-700 hover:underline"
                        title={`${product.name}${
                          product.brand?.name ? ` (${product.brand.name})` : ""
                        }`}
                      >
                        {product.name}
                      </Link>
                      {product.brand?.name ? (
                        <span className="truncate text-xs text-slate-500">
                          ({product.brand.name})
                        </span>
                      ) : null}
                    </div>
                  </SoTTd>

                  <SoTTd className="hidden text-slate-700 md:table-cell">
                    {product.category?.name || "—"}
                  </SoTTd>

                  <SoTTd className="hidden text-slate-700 lg:table-cell">
                    {packLabel}
                  </SoTTd>

                  <SoTTd className="text-slate-900">
                    <div className="space-y-1">
                      {srpNum != null ? (
                        <div className="font-mono tabular-nums">
                          <strong>₱{srpNum.toFixed(2)}</strong>{" "}
                          <span className="font-sans text-xs text-slate-500">
                            / {product.packingUnitName || "unit"}
                          </span>
                        </div>
                      ) : null}
                      {product.allowPackSale && priceNum != null ? (
                        <div className="text-xs text-slate-500">
                          Retail:{" "}
                          <span className="font-mono tabular-nums text-slate-700">
                            ₱{priceNum.toFixed(2)}
                          </span>{" "}
                          / {product.unitName}
                        </div>
                      ) : null}
                    </div>
                  </SoTTd>

                  <SoTTd className="text-slate-900">
                    {stockNum != null || packingStockNum != null ? (
                      <div className="flex flex-col gap-1">
                        {stockNum != null ? (
                          <div className="flex items-center gap-2">
                            <span>
                              <strong>Stock:</strong>{" "}
                              <span className="font-mono tabular-nums">
                                {stockNum}
                              </span>{" "}
                              {pluralize(product.packingUnitName || "")}
                            </span>
                            {isLowStock ? (
                              <span className="rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                Low
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {product.allowPackSale && packingStockNum != null ? (
                          <div className="text-xs text-slate-500">
                            <strong>Retail Stock:</strong>{" "}
                            <span className="font-mono tabular-nums">
                              {packingStockNum}
                            </span>{" "}
                            {product.unitName}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </SoTTd>

                  <SoTTd align="center" className="hidden sm:table-cell">
                    <button
                      className={clsx(
                        "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1",
                        product.isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
                        isTogglePending(product.id) &&
                          "cursor-not-allowed opacity-50"
                      )}
                      disabled={isTogglePending(product.id)}
                      aria-busy={isTogglePending(product.id)}
                      onClick={() => submitToggle(product)}
                    >
                      {isTogglePending(product.id) ? (
                        <span
                          className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-slate-400"
                          aria-label="Updating"
                          title="Updating"
                        />
                      ) : product.isActive ? (
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
                          aria-label="Active"
                          title="Active"
                        />
                      ) : (
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500"
                          aria-label="Inactive"
                          title="Inactive"
                        />
                      )}
                    </button>
                  </SoTTd>

                  <SoTTd align="center">
                    <div className="flex items-center justify-center">
                      <Link
                        to={`/products/${product.id}`}
                        className="inline-flex h-8 items-center rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-medium text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                      >
                        View
                      </Link>
                    </div>
                  </SoTTd>
                </SoTTableRow>
              );
            })}
          </tbody>
        </SoTTable>
      </div>
    );
  }

  return (
    <div className="w-full">
      <ul className="space-y-2">
        {products.map((product) => {
          const srpNum = asNumber(product.srp);
          const priceNum = asNumber(product.price);
          const stockNum = asNumber(product.stock);
          const minStockNum = asNumber(product.minStock);
          const packingStockNum = asNumber(product.packingStock);
          return (
            <li
              key={product.id}
              className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex w-full max-w-full gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400">No Img</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {product.name}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {product.brand?.name || "No brand"} • {product.category?.name || "No category"}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {srpNum != null ? (
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-slate-700">
                        ₱{srpNum.toFixed(2)} / {product.packingUnitName || "unit"}
                      </span>
                    ) : null}
                    {product.allowPackSale && priceNum != null ? (
                      <span className="rounded-lg bg-indigo-50 px-2 py-0.5 text-indigo-700">
                        Retail ₱{priceNum.toFixed(2)} / {product.unitName}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex flex-wrap gap-2">
                  {stockNum != null ? (
                    <span>
                      Stock: <strong className="font-mono">{stockNum}</strong>
                    </span>
                  ) : null}
                  {product.allowPackSale && packingStockNum != null ? (
                    <span>
                      Retail: <strong className="font-mono">{packingStockNum}</strong>
                    </span>
                  ) : null}
                  {stockNum != null &&
                  minStockNum != null &&
                  stockNum < minStockNum ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                      Low stock
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className={clsx(
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1",
                      product.isActive
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700",
                      isTogglePending(product.id) && "cursor-not-allowed opacity-50"
                    )}
                    disabled={isTogglePending(product.id)}
                    onClick={() => submitToggle(product)}
                    aria-label={product.isActive ? "Set inactive" : "Set active"}
                    title={product.isActive ? "Set inactive" : "Set active"}
                  >
                    <span
                      className={clsx(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        product.isActive ? "bg-emerald-500" : "bg-rose-500"
                      )}
                    />
                  </button>
                  <Link
                    to={`/products/${product.id}`}
                    className="inline-flex h-8 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-medium text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    View
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const ProductsListTable = memo(ProductsListTableBase);

