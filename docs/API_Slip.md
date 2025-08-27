# API & Actions — Milestone 1 (Order Slip)

This doc covers `/orders/new` and `/orders/:id/slip` for the kiosk flow.

---

## Create Slip

**POST** `/orders/new`  
Kiosk uses a Remix `fetcher` with `Accept: application/json` or appends `?respond=json`.

### Body (form fields)

- `items` — JSON array of cart lines:

  ```json
  [
    {
      "id": 123,
      "name": "RICE 25kg",
      "qty": 1,
      "unitPrice": 1200,
      "mode": "pack"
    },
    {
      "id": 456,
      "name": "Feeds 1kg",
      "qty": 0.25,
      "unitPrice": 42.5,
      "mode": "retail"
    }
  ]
  ```

  mode ∈ "retail" | "pack" (optional; server can infer from prices if omitted)

terminalId — optional string (e.g., "KIOSK-01")

Server-Side Validation (against fresh DB)

Canonical mapping

stock = pack count

packingStock = retail units

price = retail price

srp = pack price

Retail line

allowPackSale === true

price > 0

qty multiple of 0.25

qty > 0

qty <= packingStock

unitPrice === price (tolerance 1e-6)

Pack line

srp > 0

qty integer

qty > 0

qty <= stock

unitPrice === srp (tolerance 1e-6)

Effects (on success)

Create Order with:

status = "UNPAID"

subtotal, totalBeforeDiscount = subtotal

printedAt = now, expiryAt = now + 24h, printCount = 1

terminalId

items.create[]:

{
name: string,
unitPrice: number,
qty: number,
lineTotal: number,
product: { connect: { id } }
// optional: mode, unitLabel, etc. if schema includes them
}

Response

JSON (?respond=json or Accept: application/json):

Success: { "ok": true, "id": <orderId> }

Failure: { "ok": false, "errors": [ { "id": 123, "mode": "retail", "reason": "Retail qty must be a multiple of 0.25" } ] }

HTML (no JSON): 302 → /orders/:id/slip

Print Page

GET /orders/:id/slip
Renders code + QR/barcode, items, totals, expiry, reprint count.

Shows “EXPIRED” badge if expiryAt < now.

Reprint

POST /orders/:id/slip with \_action=reprint

Increments printCount

Updates printedAt to the most recent print time

Does not change expiryAt, totals, or status

State Transitions (scope of this milestone)

DRAFT → UNPAID on slip creation

Reprints do not change state

Expired UNPAID → CANCELLED (no inventory movement)

Notes

items[] may contain multiple entries with the same product id when the customer buys both Retail and Pack; each line’s unitPrice reflects its mode.

All kiosk validations are re-checked on the server to handle concurrent stock/price changes.
