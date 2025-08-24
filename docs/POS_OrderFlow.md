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

## Milestone 2 — Cashier Queue & Scan

- Cashier sees all UNPAID in queue (oldest first).
- Scan slip (QR/Barcode) → open order.
- Lock order to 1 cashier at a time.
- Cashier actions:
  - Verify items with customer.
  - Apply discounts (senior/PWD/promo/manual).
  - Cancel order (with reason).
  - Reprint slip.

## Milestone 3 — Payment & Receipt

- Payment methods: Cash, GCash, Card.
- Split payments allowed.
- Validation:
  - Cannot underpay.
  - Overpay → compute change.
- On complete payment:
  - Status = PAID.
  - Deduct inventory.
  - Assign receiptNo.
  - Print Official Receipt.
- Receipt fields:
  - Merchant info
  - Receipt No, Order Code
  - Items (qty × name, unit price, discount, line total)
  - Subtotal, Discounts, Grand Total
  - Payment breakdown
  - Change

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
UNPAID --> UNPAID_LOCKED: Cashier opens (locks)

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
