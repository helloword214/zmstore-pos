# POS Order Flow

> 📌 Purpose:  
> Describes the **lifecycle states and transitions** of orders.  
> Explains how orders move from Slip → UNPAID → PAID → VOIDED.
>
> 🛠 When to update:
>
> - If a **new state** is introduced.
> - If transitions change (e.g., when inventory is deducted).
> - When milestone flow is finalized (e.g., Payment rules).
>
> ✅ Readers:
>
> - Developers coding order handling
> - Cashiers/managers learning system behavior
> - QA/testers verifying state transitions

---

# POS Order Flow

## States

- `DRAFT` → optional parked cart.
- `UNPAID` → printed slip, awaiting cashier.
- `PAID` → cashier confirmed, payment complete.
- `CANCELLED` → closed before payment (no stock movement).
- `VOIDED` → reversal after payment (stock restored).

---

## Milestone 1 — Order Slip (UNPAID)

- Customer builds cart → Save as `UNPAID`.
- Print Order Slip with:
  - Order Code (short) + QR/Barcode
  - Line items (qty × price, line total)
  - Subtotal + Total BEFORE discounts
  - Footer: "Please pay at cashier. Discounts applied only at cashier."
- Slip expires after 24h.
- Reprint allowed (shows "Reprint #n").

**Example Payload**

```json
{
  "orderId": "a1b2c3",
  "orderCode": "8K3J5Q",
  "status": "UNPAID",
  "items": [
    {
      "productId": 123,
      "name": "Rice",
      "qty": 1,
      "unitPrice": 48,
      "lineTotal": 48
    },
    {
      "productId": 456,
      "name": "Cat Food",
      "qty": 1,
      "unitPrice": 120,
      "lineTotal": 120
    }
  ],
  "totals": { "subtotal": 168, "totalBeforeDiscount": 168 },
  "expiryAt": "2025-08-24T11:30:00+08:00"
}
```

### API & Actions (Milestone 1)

**Create Slip**

- **POST** `/orders.new`
- **Body (form):**
  - `items` — JSON array of `{ id, name, qty, unitPrice }`
  - `terminalId` — optional string (e.g., `"KIOSK-01"`)
- **Validations:** cart not empty; `qty > 0`; `unitPrice ≥ 0`.
- **Effect:** creates `Order` with `status=UNPAID`, saves snapshot items, sets `subtotal` & `totalBeforeDiscount`, sets `expiryAt = printedAt + 24h`.
- **Redirect:** `302 → /orders/:id/slip`

**Print Page**

- **GET** `/orders/:id/slip`
- Renders slip (order code + QR, items, totals, expiry, reprint count).
- Shows **“EXPIRED”** badge if `expiryAt < now`.

**Reprint**

- **POST** `/orders/:id/slip` with `_action=reprint`
- **Effect:** increments `printCount`, updates **`printedAt` to last print time** (note), **does not** change `expiryAt`, totals, or status.
- **Note:** `printedAt` reflects the **most recent** print. If we need the first-print timestamp later, we will add `firstPrintedAt`.

**State**

- `DRAFT → UNPAID` on slip creation.
- Reprints **do not** change state.

**Errors**

- 400: missing/invalid `items` payload
- 404: order not found

# API & Actions (Milestone 1) _Last updated: 2025-08-27_

This document specifies the **Order Slip** APIs used by the Kiosk. It covers request/response formats, server-side validations, and state effects.

---

## Summary

- **Create Slip:** `POST /orders/new`
- **View Slip:** `GET /orders/:id/slip`
- **Reprint Slip:** `POST /orders/:id/slip` with `_action=reprint`

> The kiosk submits via Remix `fetcher` with `Accept: application/json`. When HTML navigation is desired, omit the JSON `Accept` header and the server will `302` redirect to the slip page.

---

## Create Slip

**POST** `/orders/new`  
Kiosk uses a Remix `fetcher` with `Accept: application/json` (or append `?respond=json`).

### Purpose

Create an `UNPAID` order from the kiosk cart. The server re-validates every cart line against **current DB state** to prevent stale prices/stock.

### Request

#### Content types accepted

- `application/x-www-form-urlencoded` (Remix `<fetcher.Form>`)
- `application/json`

#### Body (form fields or JSON keys)

- `terminalId` _(optional, string)_ — e.g., `"KIOSK-01"`
- `items` _(required, array)_ — list of cart lines. Each line:

  | Field       | Type                   | Required | Notes                                                             |
  | ----------- | ---------------------- | -------- | ----------------------------------------------------------------- |
  | `id`        | number                 | ✅       | Product ID                                                        |
  | `name`      | string                 | ✅       | Snapshot of product name                                          |
  | `qty`       | number                 | ✅       | Quantity (mode-dependent rules below)                             |
  | `unitPrice` | number                 | ✅       | Snapshot unit price (must match DB’s current price for that mode) |
  | `mode`      | `"retail"` or `"pack"` | ❌       | Optional; server can infer based on `unitPrice` vs `price`/`srp`  |

#### Examples

_Form (URL-encoded via `<fetcher.Form>`)_

````json
items=[{"id":123,"name":"RICE 25kg","qty":1,"unitPrice":1200,"mode":"pack"},{"id":123,"name":"RICE 25kg","qty":0.5,"unitPrice":48,"mode":"retail"}]&terminalId=KIOSK-01

Server-side validation (fresh DB)

    - Canonical mapping

      1. stock = pack count (sacks / tanks)

      2. packingStock = retail units (kg / pcs)

      3. price = retail price (per unit)

      4. srp = pack price (per pack)

    - Retail line rules

      1. allowPackSale === true

      2. price > 0

      3. qty multiple of 0.25 (e.g., 0.25, 0.5, 0.75, …)

      4. qty ≤ packingStock

      5. unitPrice === price (guards against stale or edited price)

    - Pack line rules

      1. srp > 0

      2. qty is an integer (1, 2, 3, …)

      3. qty ≤ stock

      4. unitPrice === srp

    - Mixed-mode allowed
        The same product may appear twice (one retail line, one pack line).
        Lines are evaluated independently against their respective stock buckets.

# Effects on success

    1. Creates an Order with:
        - status: "UNPAID"
        - subtotal and totalBeforeDiscount = subtotal
        - printedAt = now
        - expiryAt = printedAt + 24h
        - printCount = 1
        - terminalId (if provided)
        - items.create[] for each valid line:
            {
                "name": "RICE 25kg",
                "unitPrice": 1200,
                "qty": 1,
                "lineTotal": 1200,
                "product": { "connect": { "id": 123 } }
              }
        Inventory is not deducted on slip creation. Deduction happens after Payment.

# Response

  1. JSON flow (when Accept: application/json or ?respond=json):
      { "ok": true, "id": 987 }

  2. Kiosk then navigates to /orders/987/slip.
      HTML flow (no JSON Accept):
        302 Found → /orders/:id/slip

#Errors (no order created)

  1. HTTP/400 with per-line error details:
      {
        "errors": [
          { "id": 123, "mode": "retail", "reason": "Retail qty must be a multiple of 0.25" },
          { "id": 456, "mode": "pack", "reason": "Pack stock insufficient (need 2, have 1)" },
          { "id": 789, "reason": "Price changed, please refresh (client 48.00, current 50.00)" }
        ]
      }
      The kiosk keeps the cart so the user can adjust/remove lines and retry.

# View Slip

  - GET /orders/:id/slip

  - Renders a printable slip page:
      > Order Code + QR/Barcode
      > Line items (qty × price, line total)
      > Subtotal & Total BEFORE discounts
      > printedAt, printCount
      > “EXPIRED” badge if expiryAt < now

# Errors
  - 404 if the order does not exist or is not visible to the branch/terminal.



# Reprint Slip
  1. POST /orders/:id/slip with _action=reprint
    > Increments printCount
    > Updates printedAt to the reprint time
    > Does not change expiryAt, totals, or status
    * printedAt represents the most recent print. If the first print timestamp is needed later, add a firstPrintedAt field.

# State changes
      DRAFT → UNPAID on slip creation
      Reprints do not change state
      Expired UNPAID → CANCELLED (no inventory movement)



---

# 📄 `docs/POS_Order_Flow.md` (delta)




```md
# POS Order Flow (Delta Update)

- **Kiosk preflight validation** added before posting to `/orders/new`. Client checks the same rules the server enforces to avoid failed submissions.
- Server remains the source of truth; it repeats validation to catch races (stock/price changed between load and submit).
- No change to inventory rules: **inventory is deducted only when the order becomes `PAID`**.




## Milestone 2 — Cashier Queue & Scan (Implemented)

- **Queue page** (`/cashier`):
  - Shows latest **UNPAID** orders (up to 50, newest first).
  - Orders display **EXPIRED** and **LOCKED** badges.
  - Open by **Order Code** (scanned/typed) or by clicking an order in the list.

- **Locking Rules**:
  - When opened, order is **locked** (`lockedAt`, `lockedBy`).
  - TTL = **5 minutes**. If no action, lock becomes **stale** and other cashiers may reclaim.
  - Atomic claim: `updateMany` ensures only one cashier can lock at a time.
  - Queue button is **disabled** when locked, tooltip shows `Locked by {cashier}`.

- **Cashier Actions**:
  - **Reprint Slip** → increments `printCount`, updates `printedAt`.
  - **Release** → clears `lockedAt`, `lockedBy`; order returns to queue.
  - **Mark Paid (Cash)** → validates items, deducts stock, updates status to `PAID`.

---

## Milestone 3 — Payment & Receipt (MVP Partial)

- **Implemented**:
  - `_action=settlePayment` on `/cashier/:id`.
  - Validates each order line against **current product data**:
    - **Retail line**:
      - `allowPackSale === true`
      - `unitPrice === Product.price`
      - Deducts from `packingStock`.
    - **Pack line**:
      - `unitPrice === Product.srp`
      - Deducts from `stock`.
    - If price mismatch or insufficient stock → error list returned.
  - On success:
    - Consolidates deductions across all lines.
    - Deducts inventory inside a transaction.
    - Updates order `status=PAID`.

- **Not yet implemented**:
  - Discounts, promos, split payments.
  - Official receipt printing (only slip + paid notice shown).

## Milestone 4 — Fulfillment & Handover

- Fulfillment states:
  - NEW
  - PICKING
  - PACKING
  - READY_FOR_PICKUP
  - HANDED_OVER
  - ON_HOLD
- Pick Ticket prints after payment.
- Picker/packer prepares order.
- Labels + Claim stub.
- Handover when customer arrives.
- Abandoned → mark UNCLAIMED.

stateDiagram-v2
direction LR

[*] --> DRAFT: (optional) Parked cart
DRAFT --> UNPAID: Print Order Slip

state "UNPAID (Slip Waiting)" as UNPAID
UNPAID: Order Slip (no discounts)\nHas expiryAt (e.g., 24h)
UNPAID --> CANCELLED: Expired or cashier cancels\n(reason required)
UNPAID --> UNPAID_LOCKED: Cashier opens (lock 5m TTL)

state "UNPAID (In‑Progress)" as UNPAID_LOCKED
UNPAID_LOCKED --> UNPAID: Release lock / timeout
UNPAID_LOCKED --> CANCELLED: Cancel (reason)
UNPAID_LOCKED --> PAID: Payment complete\n(cash / GCash / card / split)
UNPAID_LOCKED --> UNPAID_LOCKED: Edit items / apply discounts\n(audit approvals)

state "PAID (Completed Sale)" as PAID
PAID: Receipt issued • Inventory deducted\nReceiptNo assigned • Pick Ticket printed
PAID --> VOIDED: Manager void (same day)\nreason + PIN • reversal + restock
PAID --> FULFILLMENT: Auto-create fulfillment

state FULFILLMENT {
[*] --> NEW
NEW --> PICKING: Picker starts
PICKING --> PACKING: Items gathered
PACKING --> READY: Labeled / weighed (open sack if needed)
READY --> HANDED_OVER: Customer claims (scan stub)

    ' --- Exception path ---
    PICKING --> ON_HOLD: Stock issue / mismatch
    PACKING --> ON_HOLD: Weight/packing issue

    ' If issue is resolved, continue the normal flow (no cashier)
    ON_HOLD --> PICKING: Issue resolved (re-pick)
    ON_HOLD --> PACKING: Issue resolved (re-pack/rewt)

    ' If not resolvable, escalate to VOID (manager)
    ON_HOLD --> VOID_GATE: Not resolvable
    state VOID_GATE <<choice>>
    VOID_GATE --> VOIDED_FF: Manager approves VOID
    VOID_GATE --> PICKING: Manager declines VOID (try again)

    state VOIDED_FF as "VOIDED (via Fulfillment)"

}

FULFILLMENT --> HANDED_OVER
state "HANDED OVER" as HANDED_OVER
HANDED_OVER: Complete (immutable except annotations)

CANCELLED: Closed (pre‑payment)\nNo inventory movement
VOIDED: Closed (post‑payment)\nReversal + restock
VOIDED_FF --> [*]
HANDED_OVER --> [*]
CANCELLED --> [*]
VOIDED --> [*]

items[] may contain multiple entries with the same id when the customer buys both Retail and Pack. Each line’s unitPrice reflects the mode.”
````
