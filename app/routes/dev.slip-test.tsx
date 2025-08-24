import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";

export async function loader({}: LoaderFunctionArgs) {
  const products = await db.product.findMany({
    select: { id: true, name: true, price: true },
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return json({ products });
}

export default function DevSlipTest() {
  const { products } = useLoaderData<typeof loader>();
  if (!products?.length) {
    return (
      <div className="p-4">
        No products found. Seed or create at least one Product.
      </div>
    );
  }

  // build a cart payload from real products
  const items = products.map((p) => ({
    id: p.id,
    name: p.name,
    qty: 1,
    unitPrice: Number(p.price ?? 0),
  }));
  const payload = JSON.stringify(items);

  return (
    <div className="p-4 max-w-md space-y-3">
      <h1 className="text-lg font-semibold">Dev: Slip Test</h1>
      <p className="text-sm text-gray-600">
        Uses the latest products (qty=1 each). Submits to{" "}
        <code>/orders.new</code>.
      </p>

      <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto">
        {payload}
      </pre>

      <Form method="post" action="/orders.new">
        <input type="hidden" name="items" value={payload} />
        <input type="hidden" name="terminalId" value="KIOSK-01" />
        <button className="px-3 py-2 rounded bg-black text-white text-sm">
          Create & Open Slip
        </button>
      </Form>
    </div>
  );
}
