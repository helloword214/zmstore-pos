# API & Actions — Order Ticket _(formerly “Slip”)_

This covers `POST /orders/new` and `GET /orders/:id/ticket` used by the Order Pad.

---

## Create Order

**POST** `/orders/new` (Remix fetcher, `Accept: application/json` or `?respond=json`)

### Body

- `items`: JSON array of cart lines `{ id, name, qty, unitPrice, mode }`
- `terminalId` (optional)

Server revalidates each line against current DB:

- Retail: allowPackSale, price>0, qty%0.25==0, qty≤packingStock, unitPrice===price.
- Pack: srp>0, qty integer, qty≤stock, unitPrice===srp.
- Mixed-mode allowed.

### Effects (success)

- Create `Order` with `status=UNPAID`, snapshot items & totals, `printedAt`, `expiryAt=+24h`, `printCount=1`, `orderCode`.
- **No inventory deduction**.

### Response

- JSON: `{ ok: true, id }` (or 400 with `{ errors: [...] }`)

---

## Ticket Page

**GET** `/orders/:id/ticket`

- Renders code + barcode, items, totals, expiry, reprint count.
- `?autoprint=1&autoback=1` → single guarded auto-print (uses `afterprint`), then returns to previous screen (or queue fallback).

**Reprint**

- **POST** `/orders/:id/ticket` with `_action=reprint`  
  Increments `printCount`, updates `printedAt`. No state/totals change.

---

## Print Layout (57 mm)

- Wrap content with `.ticket` root and use 57 mm print CSS (narrow margins, mono totals, hide controls on `@media print`).
