import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ProductUpsertForm } from "~/components/products/ProductUpsertForm";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { createUploadSessionKey } from "~/features/uploads/upload-policy";
import { getProductFormReferences } from "~/features/products/product-form.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const refs = await getProductFormReferences();
  const uploadSessionKey = createUploadSessionKey();
  return json({ refs, uploadSessionKey });
}

export default function ProductCreateRoute() {
  const { refs, uploadSessionKey } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      <SoTNonDashboardHeader
        title="New Product"
        subtitle="Create a catalog product."
        backTo="/products"
        backLabel="Product List"
        maxWidthClassName="max-w-5xl"
      />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-6">
        <ProductUpsertForm
          mode="create"
          refs={refs}
          uploadSessionKey={uploadSessionKey}
        />
      </div>
    </main>
  );
}
