// app/components/ui/ProductTable.tsx

import type { ProductWithDetails } from "~/types";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/Button";
import { clsx } from "clsx";

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
  return (
    <div className="overflow-auto rounded-xl border bg-surface max-h-[70vh]">
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
            <th className="p-2">Active?</th>
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
              product.packingSize && product.unitName && product.packingUnitName
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
                        Retail: ₱{product.price.toFixed(2)} / {product.unitName}
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

                <td className="p-2 text-center">
                  <button
                    className={clsx(
                      "inline-block px-2 py-1 text-xs rounded font-medium transition",
                      product.isActive
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-red-100 text-red-700 hover:bg-red-200"
                    )}
                    onClick={() => {
                      const form = new FormData();
                      form.append("toggleId", product.id.toString());
                      form.append("isActive", (!product.isActive).toString());
                      actionFetcher.submit(form, { method: "post" });
                    }}
                  >
                    {product.isActive ? "🟢" : "🔴"}
                  </button>
                </td>

                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      className="text-xs border px-2 py-1 text-gray-600 hover:bg-gray-100"
                      onClick={() => onEdit(product)}
                    >
                      ✏️
                    </Button>
                    <Button
                      variant="danger"
                      className="text-xs px-2 py-1"
                      onClick={() => {
                        if (
                          confirm(
                            "Are you sure you want to delete this product?"
                          )
                        ) {
                          onDelete(product.id);
                        }
                      }}
                    >
                      🗑
                    </Button>
                    {product.allowPackSale &&
                      (product.packingSize ?? 0) > 0 &&
                      (product.stock ?? 0) > 0 && (
                        <Button
                          variant="ghost"
                          className="text-xs border px-2 py-1 text-gray-600 hover:bg-gray-100"
                          onClick={() => {
                            const packsStr = window.prompt(
                              "Open how many whole packs?",
                              "1"
                            );
                            if (!packsStr) return;

                            const fd = new FormData();
                            fd.append("_action", "open-pack");
                            fd.append("id", String(product.id));
                            fd.append("packs", packsStr);
                            actionFetcher.submit(fd, { method: "post" });
                          }}
                          title="Move one or more whole packs into retail stock"
                        >
                          🥡
                        </Button>
                      )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
