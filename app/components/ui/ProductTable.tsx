// app/components/ui/ProductTable.tsx

import type { Product, Category, Brand } from "@prisma/client";
type ProductWithDetails = Product & {
  category: Category | null;
  brand: Brand | null;
};

import { Button } from "~/components/ui/Button";
import { clsx } from "clsx";

interface Props {
  products: ProductWithDetails[];
  onEdit: (product: ProductWithDetails) => void;
  onDelete: (id: number) => void;
}

export function ProductTable({ products, onEdit, onDelete }: Props) {
  return (
    <div className="overflow-auto rounded-xl border bg-surface">
      <table className="min-w-full text-sm font-sans">
        <thead className="bg-surface-strong text-left">
          <tr className="text-xs text-gray-600 uppercase tracking-wider font-heading">
            <th className="p-3">ID</th>
            <th className="p-3">Name</th>
            <th className="p-3">Category</th>
            <th className="p-3">Price</th>
            <th className="p-3">Stock</th>
            <th className="p-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => (
            <tr
              key={product.id}
              className={clsx(
                "border-t transition hover:bg-gray-50",
                index % 2 === 0 && "bg-surface-subtle"
              )}
            >
              <td className="p-3 text-sm text-gray-600">{product.id}</td>
              <td className="p-3 font-semibold text-gray-900">
                {product.name}
                {product.brand?.name && (
                  <span className="ml-1 text-gray-500 text-sm">
                    ({product.brand.name})
                  </span>
                )}
              </td>
              <td className="p-3 text-gray-700">
                {product.category?.name || "—"}
              </td>
              <td className="p-3 text-gray-700">
                {typeof product.price === "number"
                  ? `₱${product.price.toFixed(2)} / ${product.unit}`
                  : "—"}
              </td>
              <td className="p-3 text-gray-700">
                {product.stock && product.packingSize && product.unit
                  ? `${product.stock} pcs – ${product.packingSize} per ${product.unit}`
                  : product.stock || "—"}
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="text-xs border px-2 py-1 text-gray-600 hover:bg-gray-100"
                    onClick={() => onEdit(product)}
                  >
                    ✏️ Edit
                  </Button>
                  <Button
                    variant="danger"
                    className="text-xs px-2 py-1"
                    onClick={() => {
                      if (
                        confirm("Are you sure you want to delete this product?")
                      ) {
                        onDelete(product.id);
                      }
                    }}
                  >
                    🗑 Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
