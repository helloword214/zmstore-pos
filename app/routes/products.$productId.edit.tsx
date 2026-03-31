import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ProductUpsertForm } from "~/components/products/ProductUpsertForm";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { createUploadSessionKey } from "~/features/uploads/upload-policy";
import {
  getProductFormReferences,
  getProductInitialData,
} from "~/features/products/product-form.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const productId = Number(params.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Response("Invalid product ID", { status: 400 });
  }

  const initialProduct = await getProductInitialData(productId);

  if (!initialProduct) {
    throw new Response("Product not found", { status: 404 });
  }

  const refs = await getProductFormReferences({
    includeCategoryId: initialProduct.categoryId ?? null,
  });

  const uploadSessionKey = createUploadSessionKey();
  return json({ refs, initialProduct, uploadSessionKey });
}

export default function ProductEditRoute() {
  const { refs, initialProduct, uploadSessionKey } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="Edit Product"
        subtitle="Update the catalog record."
        backTo={`/products/${initialProduct.id}`}
        backLabel="Product Detail"
        maxWidthClassName="max-w-5xl"
      />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-6">
        <SoTActionBar
          left={
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                {initialProduct.name}
              </h2>
              <p className="text-xs text-slate-500">
                Product #{initialProduct.id}
              </p>
            </div>
          }
          right={
            <Link
              to={`/products/${initialProduct.id}`}
              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              View Detail
            </Link>
          }
        />

        <ProductUpsertForm
          mode="edit"
          refs={refs}
          initialProduct={initialProduct}
          uploadSessionKey={uploadSessionKey}
        />
      </div>
    </main>
  );
}
