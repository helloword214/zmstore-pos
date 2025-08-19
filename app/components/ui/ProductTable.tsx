// app/components/ui/ProductTable.tsx

import type { ProductWithDetails } from "~/types";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/Button";
import { clsx } from "clsx";
import React, { useState, useEffect } from "react";

interface Props {
  products: ProductWithDetails[];
  onEdit: (product: ProductWithDetails) => void;
  onDelete: (id: number) => void;
  highlightId?: number | null;
  actionFetcher: ReturnType<typeof useFetcher>;
}

export function ProductTable({
  products,
  onEdit,
  onDelete,
  highlightId,
  actionFetcher,
}: Props) {
  const [quickView, setQuickView] = useState<ProductWithDetails | null>(null);
  const [pendingToggle, setPendingToggle] = useState(false);

  const Field = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-gray-500 leading-4">
        {label}
      </div>
      <div className="text-gray-900 text-sm leading-5 break-words">
        {children ?? "—"}
      </div>
    </div>
  );

  const peso = (n?: number | null) =>
    typeof n === "number" && isFinite(n) ? `₱${n.toFixed(2)}` : "—";

  const Pill: React.FC<{
    label: string;
    tone?: "green" | "red" | "amber" | "gray";
    value: React.ReactNode;
    unit?: string;
  }> = ({ label, tone = "gray", value, unit }) => (
    <div
      className={clsx(
        "px-2.5 py-1.5 rounded-md border text-sm flex items-baseline gap-1.5 shrink-0",
        tone === "green" && "bg-green-50 border-green-200 text-green-800",
        tone === "red" && "bg-red-50 border-red-200 text-red-800",
        tone === "amber" && "bg-amber-50 border-amber-200 text-amber-800",
        tone === "gray" && "bg-gray-50 border-gray-200 text-gray-800"
      )}
    >
      <span className="text-[11px] uppercase tracking-wide opacity-80">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
      {unit && <span className="text-[11px] opacity-70">/ {unit}</span>}
    </div>
  );

  const [pending, setPending] = useState<{
    kind: "toggle" | null;
    id: number | null;
  }>({
    kind: null,
    id: null,
  });
  useEffect(() => {
    if (actionFetcher.state === "idle" && pending.kind === "toggle") {
      // done: clear lock
      setPending({ kind: null, id: null });
    }
  }, [actionFetcher.state, pending.kind]);

  // ✅ Live update effect
  useEffect(() => {
    if (actionFetcher.state !== "idle") return;

    // If your action returns JSON like { toggledId, newIsActive, error }
    const data = actionFetcher.data as any;

    if (pendingToggle) {
      if (data?.error) {
        // Revert optimistic change on error
        setQuickView((prev) =>
          prev ? { ...prev, isActive: !prev.isActive } : prev
        );
        // (Optional) show a toast here
      } else if (
        data &&
        typeof data === "object" &&
        typeof data.newIsActive === "boolean" &&
        quickView &&
        data.toggledId === quickView.id
      ) {
        // Sync to server's truth if provided
        setQuickView((prev) =>
          prev ? { ...prev, isActive: data.newIsActive } : prev
        );
      } else {
        // Or reconcile from the revalidated products list
        if (quickView) {
          const fresh = products.find((p) => p.id === quickView.id);
          if (fresh && typeof fresh.isActive === "boolean") {
            setQuickView((prev) =>
              prev ? { ...prev, isActive: fresh.isActive } : prev
            );
          }
        }
      }
      setPendingToggle(false);
    }
  }, [
    actionFetcher.state,
    actionFetcher.data,
    pendingToggle,
    products,
    quickView,
  ]);

  return (
    <>
      <div className="hidden sm:block overflow-auto rounded-xl border bg-surface max-h-[70vh]">
        <table className="min-w-full text-sm font-sans">
          <thead className="sticky top-0 z-0 bg-white dark:bg-surface-dark shadow-sm border-b text-left">
            <tr className="text-xs text-gray-600 uppercase tracking-wider font-heading">
              <th className="p-2 hidden sm:table-cell">ID</th>
              <th className="p-2">Name (Brand)</th>
              <th className="p-2 hidden md:table-cell">Category</th>
              <th className="p-2 hidden lg:table-cell">Uses</th>
              <th className="p-2 hidden lg:table-cell">Targets</th>
              <th className="p-2 hidden lg:table-cell">Packaging</th>
              <th className="p-2">Pricing</th>
              <th className="p-2">Stock</th>
              <th className="p-2 hidden md:table-cell">Location</th>
              <th className="p-2 hidden sm:table-cell">Active?</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr className="h-0">
              <td colSpan={11}>
                <div id="table-anchor" className="scroll-mt-24" />
              </td>
            </tr>

            {products.map((product, index) => {
              const pluralize = (word: string) =>
                word && !word.endsWith("s") ? `${word}s` : word;

              const packLabel =
                product.packingSize &&
                product.unitName &&
                product.packingUnitName
                  ? `${product.packingSize} ${pluralize(product.unitName)} / ${
                      product.packingUnitName
                    }`
                  : "—";

              const isLowStock =
                product.stock != null &&
                product.minStock != null &&
                product.stock < product.minStock;

              return (
                <tr
                  key={product.id}
                  className={clsx(
                    "border-t transition hover:bg-gray-50 cursor-default",
                    index % 2 === 0 && "bg-surface-subtle",
                    product.id === highlightId && "highlight-row",
                    isLowStock && "bg-red-50"
                  )}
                  style={
                    product.id === highlightId
                      ? { backgroundColor: "#d1fae5" }
                      : {}
                  }
                >
                  <td className="p-2 text-gray-600 hidden sm:table-cell">
                    {product.id}
                  </td>

                  <td className="p-2 max-w-[200px] text-gray-900 align-top">
                    <div
                      className="flex flex-col overflow-hidden"
                      title={`${product.name}${
                        product.brand?.name ? ` (${product.brand.name})` : ""
                      }`}
                    >
                      <span className="font-semibold text-sm truncate">
                        {product.name}
                      </span>
                      {product.brand?.name && (
                        <span className="text-xs text-gray-500 truncate">
                          ({product.brand.name})
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="p-2 text-gray-700 hidden md:table-cell">
                    {product.category?.name || "—"}
                  </td>

                  <td className="p-2 text-gray-700 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {product.indications?.length ? (
                        product.indications.map((i) => (
                          <span
                            key={i.id}
                            className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
                          >
                            {i.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </div>
                  </td>

                  <td className="p-2 text-gray-700 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {product.targets?.length ? (
                        product.targets.map((t) => (
                          <span
                            key={t.id}
                            className="inline-block bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full"
                          >
                            {t.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </div>
                  </td>

                  <td className="p-2 text-gray-700 hidden lg:table-cell">
                    {packLabel}
                  </td>

                  <td className="p-2 text-gray-700 text-sm">
                    <div className="space-y-1">
                      {product.srp != null && (
                        <div>
                          <strong>₱{product.srp.toFixed(2)}</strong>{" "}
                          <span className="text-xs text-gray-500">
                            / {product.packingUnitName || "unit"}
                          </span>
                        </div>
                      )}
                      {product.allowPackSale && product.price != null && (
                        <div className="text-xs text-gray-500">
                          Retail: ₱{product.price.toFixed(2)} /{" "}
                          {product.unitName}
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="p-2 text-gray-700 text-sm">
                    {product.stock != null || product.packingStock != null ? (
                      <div className="flex flex-col gap-1">
                        {product.stock != null && (
                          <div className="flex items-center gap-2">
                            <span>
                              <strong>Stock:</strong> {product.stock}{" "}
                              {pluralize(product.packingUnitName || "")}
                            </span>
                            {isLowStock && (
                              <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded font-semibold">
                                ⚠ Low
                              </span>
                            )}
                          </div>
                        )}
                        {product.allowPackSale &&
                          product.packingStock != null && (
                            <div className="text-xs text-gray-500">
                              <strong>Retail Stock:</strong>{" "}
                              {product.packingStock} {product.unitName}
                            </div>
                          )}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  <td className="p-2 text-gray-700 hidden md:table-cell">
                    {product.locationName || "—"}
                  </td>

                  <td className="p-2 hidden text-center sm:table-cell">
                    <button
                      className={clsx(
                        "inline-block px-2 py-1 text-xs rounded font-medium transition",
                        product.isActive
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-red-100 text-red-700 hover:bg-red-200",
                        pending.kind === "toggle" &&
                          pending.id === product.id &&
                          "opacity-50 cursor-not-allowed"
                      )}
                      disabled={
                        pending.kind === "toggle" && pending.id === product.id
                      }
                      aria-busy={
                        pending.kind === "toggle" && pending.id === product.id
                      }
                      onClick={() => {
                        if (pending.kind) return; // guard
                        const form = new FormData();
                        form.append("toggleId", product.id.toString());
                        form.append("isActive", (!product.isActive).toString());
                        setPending({ kind: "toggle", id: product.id });
                        actionFetcher.submit(form, { method: "post" });
                      }}
                    >
                      {pending.kind === "toggle" && pending.id === product.id
                        ? "…"
                        : product.isActive
                        ? "🟢"
                        : "🔴"}
                    </button>
                  </td>

                  <td className="p-2 text-center align-middle">
                    <button
                      onClick={() => setQuickView(product)}
                      className="bg-blue-50 text-blue-700 px-3 py-0.5 
                      text-xs rounded-full hover:bg-blue-100"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 📱 Mobile list (no horizontal scroll) */}
      <div className="sm:hidden w-full max-w-full overflow-x-hidden">
        <ul className="divide-y divide-gray-200 w-full overflow-x-hidden">
          {products.map((product) => {
            return (
              <li key={product.id} className="px-3 py-3 w-full overflow-hidden">
                <div className="flex gap-3 w-full max-w-full">
                  {/* Thumb */}
                  <div className="w-10 h-10 rounded-md overflow-hidden bg-gray-100 border flex items-center justify-center shrink-0">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-[10px] text-gray-400">No Img</span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 w-full">
                    {/* LINE 1: name/brand on left, status + view on right (tight) */}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 w-full">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">
                          {product.name}
                        </div>
                        {product.brand?.name && (
                          <div className="text-[11px] text-gray-500 truncate">
                            {product.brand.name}
                          </div>
                        )}
                      </div>

                      {/* right cluster: status + view */}
                      <div className="flex items-center gap-2 justify-self-end whitespace-nowrap">
                        <span
                          className={clsx(
                            "inline-block h-2.5 w-2.5 rounded-full",
                            product.isActive ? "bg-green-500" : "bg-red-500"
                          )}
                          aria-label={product.isActive ? "Active" : "Inactive"}
                        />
                        <button
                          onClick={() => setQuickView(product)}
                          className="px-2 py-0.5 text-[11px] font-medium text-gray-700
                       border border-gray-300 rounded-md
                       hover:bg-gray-50 focus:outline-none
                       focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                          aria-label={`View details for ${product.name}`}
                        >
                          View
                        </button>
                      </div>
                    </div>

                    {/* LINE 2: prices */}
                    <div className="mt-1 text-[11px] text-gray-700 flex flex-wrap gap-x-3 gap-y-1 min-w-0">
                      {product.srp != null && (
                        <span className="truncate ">
                          <strong>₱{product.srp.toFixed(2)}</strong>
                          <span className="text-gray-500">
                            {" "}
                            / {product.packingUnitName || "unit"}
                          </span>
                        </span>
                      )}
                      {product.allowPackSale && product.price != null && (
                        <span className="text-gray-600 truncate">
                          Retail ₱{product.price.toFixed(2)}
                          <span className="text-gray-400">
                            {" "}
                            / {product.unitName}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* LINE 3: stock + location */}
                    <div className="mt-1 text-[11px] text-gray-700 flex flex-wrap items-center gap-2">
                      {product.stock != null && (
                        <span className="truncate">
                          <strong>Stock:</strong> {product.stock}{" "}
                          {product.packingUnitName || ""}
                        </span>
                      )}
                      {product.allowPackSale &&
                        product.packingStock != null && (
                          <span className="text-gray-500 truncate">
                            Retail: {product.packingStock} {product.unitName}
                          </span>
                        )}
                      {product.minStock != null &&
                        product.stock != null &&
                        product.stock < product.minStock && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                            Low
                          </span>
                        )}
                      {product.locationName && (
                        <span className="text-gray-500 truncate">
                          • {product.locationName}
                        </span>
                      )}
                    </div>

                    {/* LINE 4: quick meta (compact) */}
                    <div className="mt-1 text-[11px] text-gray-600 flex flex-wrap gap-2">
                      {product.category?.name && (
                        <span>{product.category.name}</span>
                      )}
                      {!!product.indications?.length && (
                        <span className="text-gray-500">
                          • {product.indications.length} uses
                        </span>
                      )}
                      {!!product.targets?.length && (
                        <span className="text-gray-500">
                          • {product.targets.length} targets
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 🪟 CENTERED VIEW PANEL (modal) */}

      {quickView &&
        (() => {
          const cost = quickView.dealerPrice ?? null; // per whole pack/unit
          const packSize = Number(quickView.packingSize ?? 0);
          const srp = quickView.srp ?? null; // per whole pack/unit
          const retail = quickView.allowPackSale
            ? quickView.price ?? null
            : null;

          const floorRetail =
            cost != null && packSize > 0 ? cost / packSize : null; // min allowed retail
          const maxDiscAmount = srp != null && cost != null ? srp - cost : null;
          const maxDiscPct =
            srp && srp > 0 && maxDiscAmount != null
              ? (maxDiscAmount / srp) * 100
              : null;

          const retailBelowFloor =
            quickView.allowPackSale &&
            floorRetail != null &&
            retail != null &&
            retail < floorRetail;

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              {/* backdrop */}
              <div
                className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
                onClick={() => setQuickView(null)}
                aria-hidden="true"
              />

              {/* centered panel */}
              <div
                role="dialog"
                aria-modal="true"
                className="relative w-[92vw] max-w-[880px] bg-white text-gray-900 rounded-2xl shadow-2xl overflow-hidden"
              >
                {/* header */}
                <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500">#{quickView.id}</div>
                    <div className="font-semibold text-lg truncate">
                      {quickView.name}
                      {quickView.brand?.name && (
                        <span className="ml-1 text-gray-500">
                          ({quickView.brand.name})
                        </span>
                      )}
                      <span
                        className={clsx(
                          "ml-2 text-xs px-2 py-0.5 rounded-full border",
                          quickView.isActive
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        )}
                      >
                        {quickView.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="shrink-0 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                    onClick={() => setQuickView(null)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                {/* content (scrolls if tall) */}
                <div className="p-4 sm:p-6 max-h-[75vh] overflow-y-auto">
                  {/* Two-pane: image | details */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 sm:gap-6">
                    {/* Left: Image */}
                    <div className="sm:col-span-3">
                      <div className="w-full aspect-[1/1] rounded-xl overflow-hidden bg-gray-100 border flex items-center justify-center">
                        {quickView.imageUrl ? (
                          <img
                            src={quickView.imageUrl}
                            alt={quickView.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs text-gray-400">
                            No Image
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Fields grid (keep your existing blocks) */}
                    <div className="sm:col-span-9">
                      {/* Block 1: Identity */}
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
                        <Field label="Brand">
                          {quickView.brand?.name || "—"}
                        </Field>
                        <Field label="Category">
                          {quickView.category?.name || "—"}
                        </Field>
                        <Field label="Unit">{quickView.unitName || "—"}</Field>
                        <Field label="Location">
                          {quickView.locationName || "—"}
                        </Field>
                      </div>
                      <div className="h-px bg-gray-200 my-4 sm:my-5" />
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 lg:gap-5">
                        <div className="md:col-span-4">
                          <Field label="Packaging">
                            {quickView.packingSize &&
                            quickView.unitName &&
                            quickView.packingUnitName ? (
                              `${quickView.packingSize} ${
                                quickView.unitName.endsWith("s")
                                  ? quickView.unitName
                                  : quickView.unitName + "s"
                              } / ${quickView.packingUnitName}`
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </Field>
                        </div>

                        <div className="md:col-span-3">
                          <Field label="Allow Retail">
                            {quickView.allowPackSale ? "Yes" : "No"}
                          </Field>
                        </div>

                        {/* Keep this cell empty to align with the Pricing Rail below on small screens */}
                        <div className="md:col-span-5 hidden md:block" />
                      </div>
                      <div className="h-px bg-gray-200 my-4 sm:my-5" />
                      {/* --- Pricing (compact & aligned) --- */}
                      <div className="space-y-1">
                        <div className="text-[11px] text-gray-500">Pricing</div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-1">
                          {/* Cost (per pack) */}
                          <Pill
                            label="Cost"
                            tone="red"
                            value={peso(cost)}
                            unit={quickView.packingUnitName || "unit"}
                          />

                          {/* Floor Retail (only if retail is allowed) */}
                          {quickView.allowPackSale && (
                            <Pill
                              label="Floor"
                              tone="red"
                              value={peso(floorRetail)}
                              unit={quickView.unitName || "unit"}
                            />
                          )}

                          {/* SRP (per pack) */}
                          <Pill
                            label="SRP"
                            tone="green"
                            value={peso(srp)}
                            unit={quickView.packingUnitName || "unit"}
                          />

                          {/* Retail (per retail unit) */}
                          {quickView.allowPackSale && (
                            <Pill
                              label="Retail"
                              tone={retailBelowFloor ? "amber" : "green"}
                              value={peso(retail)}
                              unit={quickView.unitName || "unit"}
                            />
                          )}

                          {/* Max Discount */}
                          <Pill
                            label="Max Disc"
                            tone="amber"
                            value={
                              <>
                                {peso(maxDiscAmount)}
                                {maxDiscPct != null && (
                                  <span className="text-[11px] opacity-70">
                                    {" "}
                                    ({maxDiscPct.toFixed(1)}%)
                                  </span>
                                )}
                              </>
                            }
                          />
                        </div>

                        {/* Optional hint when retail is below floor */}
                        {retailBelowFloor && (
                          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
                            Retail is below floor (cost ÷ pack size). You may be
                            selling at a loss.
                          </div>
                        )}
                      </div>
                      <div className="h-px bg-gray-200 my-4 sm:my-5" />
                      {/* Block 3: Inventory */}
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
                        <Field label="Stock">
                          {quickView.stock != null
                            ? `${quickView.stock} ${
                                quickView.packingUnitName || ""
                              }`
                            : "—"}
                        </Field>
                        <Field label="Retail Stock">
                          {quickView.allowPackSale &&
                          quickView.packingStock != null
                            ? `${quickView.packingStock} ${
                                quickView.unitName || ""
                              }`
                            : "—"}
                        </Field>
                        <Field label="Min Stock">
                          {quickView.minStock ?? "—"}
                        </Field>
                        <Field label="Replenish At">
                          {quickView.replenishAt
                            ? new Date(quickView.replenishAt)
                                .toISOString()
                                .slice(0, 10)
                            : "—"}
                        </Field>
                      </div>
                      <div className="h-px bg-gray-200 my-4 sm:my-5" />
                      {/* Block 4: IDs */}
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
                        <Field label="Barcode">
                          {quickView.barcode || "—"}
                        </Field>
                        <Field label="SKU">{quickView.sku || "—"}</Field>
                        <Field label="Expiration">
                          {quickView.expirationDate
                            ? new Date(quickView.expirationDate)
                                .toISOString()
                                .slice(0, 10)
                            : "—"}
                        </Field>
                        <div className="hidden xl:block" />
                      </div>
                      <div className="h-px bg-gray-200 my-4 sm:my-5" />
                      {/* Block 5: Tags */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[11px] font-medium text-gray-500 mb-1">
                            Uses
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {quickView.indications?.length ? (
                              quickView.indications.map((i) => (
                                <span
                                  key={i.id}
                                  className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
                                >
                                  {i.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-400 text-sm">—</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium text-gray-500 mb-1">
                            Targets
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {quickView.targets?.length ? (
                              quickView.targets.map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-block bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full"
                                >
                                  {t.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-400 text-sm">—</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="h-px bg-gray-200 my-4 sm:my-5" />
                      {/* Block 6: Description */}
                      <div>
                        <div className="text-[11px] font-medium text-gray-500 mb-1">
                          Description
                        </div>
                        <div className="text-gray-900 text-sm whitespace-pre-wrap break-words">
                          {quickView.description || "—"}
                        </div>
                      </div>
                      {/* Footer buttons */}+ {/* Footer actions */}
                      <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
                        {/* Left: destructive & utility */}
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            className="text-xs px-3 py-1.5"
                            onClick={() => {
                              if (!quickView) return;
                              if (confirm("Delete this product permanently?")) {
                                onDelete(quickView.id);
                                setQuickView(null);
                              }
                            }}
                          >
                            🗑 Delete
                          </Button>

                          {quickView?.allowPackSale &&
                            (quickView.packingSize ?? 0) > 0 &&
                            (quickView.stock ?? 0) > 0 && (
                              <Button
                                variant="ghost"
                                className="text-xs border px-3 py-1.5 text-gray-600 hover:bg-gray-100"
                                onClick={() => {
                                  if (!quickView) return;
                                  const packsStr = window.prompt(
                                    "Open how many whole packs?",
                                    "1"
                                  );
                                  if (!packsStr) return;
                                  const fd = new FormData();
                                  fd.append("_action", "open-pack");
                                  fd.append("id", String(quickView.id));
                                  fd.append("packs", packsStr);
                                  actionFetcher.submit(fd, { method: "post" });
                                }}
                                title="Move one or more whole packs into retail stock"
                              >
                                🥡 Open Packs
                              </Button>
                            )}
                        </div>

                        {/* Right: primary actions */}
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            className="text-xs border px-3 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none"
                            disabled={
                              pending.kind === "toggle" &&
                              pending.id === quickView?.id
                            }
                            onClick={() => {
                              if (!quickView) return;
                              if (pending.kind) return; // hard guard against double-click
                              // optimistic flip for live color/badge
                              setQuickView((prev) =>
                                prev
                                  ? { ...prev, isActive: !prev.isActive }
                                  : prev
                              );
                              setPending({ kind: "toggle", id: quickView.id });

                              const form = new FormData();
                              form.append("toggleId", String(quickView.id));
                              form.append(
                                "isActive",
                                String(!quickView.isActive)
                              );
                              actionFetcher.submit(form, { method: "post" });
                            }}
                            aria-busy={
                              pending.kind === "toggle" &&
                              pending.id === quickView?.id
                            }
                            title={
                              quickView?.isActive ? "Deactivate" : "Activate"
                            }
                          >
                            {pending.kind === "toggle" &&
                            pending.id === quickView?.id
                              ? "…"
                              : quickView?.isActive
                              ? "🔴 Deactivate"
                              : "🟢 Activate"}
                          </Button>

                          <Button
                            variant="ghost"
                            className="text-xs border px-3 py-1.5 text-gray-600 hover:bg-gray-100"
                            onClick={() => {
                              if (!quickView) return;
                              setQuickView(null);
                              onEdit(quickView);
                            }}
                          >
                            ✏️ Edit
                          </Button>

                          <Button
                            variant="ghost"
                            className="text-xs border px-3 py-1.5 text-gray-600 hover:bg-gray-100"
                            onClick={() => setQuickView(null)}
                          >
                            Close
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
