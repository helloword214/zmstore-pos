import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ProductUpsertForm } from "~/components/products/ProductUpsertForm";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import {
  getProductFormReferences,
  getProductInitialData,
} from "~/features/products/product-form.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const productId = Number(params.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Response("Invalid product ID", { status: 400 });
  }

  const [refs, initialProduct] = await Promise.all([
    getProductFormReferences(),
    getProductInitialData(productId),
  ]);

  if (!initialProduct) {
    throw new Response("Product not found", { status: 404 });
  }

  return json({ refs, initialProduct });
}

export default function ProductEditRoute() {
  const { refs, initialProduct } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="Edit Product"
        subtitle={`Product #${initialProduct.id} - ${initialProduct.name}`}
        backTo={`/products/${initialProduct.id}`}
        backLabel="Product Detail"
        maxWidthClassName="max-w-5xl"
      />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-6">
        <SoTActionBar
          right={
            <>
              <Link
                to={`/products/${initialProduct.id}`}
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                View Detail
              </Link>
              <Link
                to="/products"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Back to List
              </Link>
            </>
          }
        />

        <ProductUpsertForm mode="edit" refs={refs} initialProduct={initialProduct} />
      </div>
    </main>
  );
}
