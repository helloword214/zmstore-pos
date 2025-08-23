# POS Code Snippets

This file keeps important **code fragments** tied to milestones.  
Think of it as a scrapbook: working examples, not the full app.  
Always update when a milestone implementation is done.

---

## 2025-08-15 — Product CRUD (baseline)

**File:** `app/routes/products._index.tsx`

- Finished Create, Update, Delete for products.
- Inventory searchable.
- Code working in deployed Docker image.

_(Code omitted here — already live in repo, reference Git commit `abc123`)_

---

## 2025-08-21 — Order Slip Action (v1 draft)

**File:** `app/routes/orders._index.tsx`

```ts
// Remix action: create UNPAID order from kiosk/cart
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const items = JSON.parse(formData.get("items") as string);

  const order = await db.order.create({
    data: {
      status: "UNPAID",
      items: {
        create: items.map((i) => ({
          productId: i.id,
          productName: i.name,
          qty: i.qty,
          unitPrice: i.price,
          lineTotal: i.qty * i.price,
        })),
      },
    },
    include: { items: true },
  });

  return json({ success: true, order });
}
```
