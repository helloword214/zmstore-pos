# API & Page — Receipt

## View Receipt

**GET** `/orders/:id/receipt[?autoprint=1&autoback=1]`

### Behavior

- Requires: `Order.status === "PAID"` and `receiptNo` set.
- Renders merchant header, items, totals, payments, change.
- If `autoprint=1` is present:
  - A **single guarded effect** triggers `window.print()` once.
  - An `afterprint` handler returns to `/cashier` when `autoback=1`.

### Fields shown

- Receipt No, Order Code, Date/Time (`paidAt`), Items (qty × price, line total)
- Subtotal, (Discounts TBD), **Grand Total**
- Payments list (method, ref), **Change**

## Allocate Receipt Number (server)

- `utils/receipt.allocateReceiptNo(tx)` uses `ReceiptCounter` to `upsert` and increment:
  - Input: a Prisma transaction client
  - Output: formatted `receiptNo` string (e.g., `ZMD-000123`)
