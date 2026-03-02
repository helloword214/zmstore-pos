import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ProductUpsertForm } from "~/components/products/ProductUpsertForm";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { getProductFormReferences } from "~/features/products/product-form.server";

export async function loader() {
  const refs = await getProductFormReferences();
  return json({ refs });
}

export default function ProductCreateRoute() {
  const { refs } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="New Product"
        subtitle="Dedicated create route with parity-safe product encode behavior."
        backTo="/products"
        backLabel="Product List"
        maxWidthClassName="max-w-5xl"
      />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-6">
        <ProductUpsertForm mode="create" refs={refs} />
      </div>
    </main>
  );
}
