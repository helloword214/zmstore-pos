# API — Official Receipt (57 mm)

**GET** `/orders/:id/receipt[?autoprint=1&autoback=1]`

### Preconditions

- `order.status = PAID` OR (Delivery remit flow) order just settled in batch
- `receiptNo` allocated
- Include `payments[]` to show breakdown

### Render

- Merchant header, **Receipt No**, Order Code
- Date/Time (paidAt), Item lines (qty × unit price → line total)
- Subtotal, (optional) Discounts, **Grand Total**
- Payments (multiple lines), **Change**

### Auto-print

- If `autoprint=1`, trigger **once** using a ref + `afterprint` listener
- If `autoback=1`, navigate back to **/cashier** after print (or history back)

### Reprint

- Reprinting receipts should mark an audit note (not required in v1)
