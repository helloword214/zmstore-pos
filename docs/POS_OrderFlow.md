# POS Order Flow

> **Purpose**  
> States & transitions from Order creation to Handover/Delivery/Settlement.

---

## States

- `DRAFT` — optional parked cart
- `UNPAID` — created order (ticket optional), awaiting cashier or dispatch
- `PARTIALLY_PAID` — some payment received, balance > 0
- `PAID` — fully settled (receipts print)
- `CANCELLED` — closed before handover/dispatch (no stock movement)
- `VOIDED` — reversal after stock movement/payment (restock/refund)

---

## Key Transitions

- **Create Order** (no print or with ticket): `DRAFT → UNPAID`
- **In-store, pay now**: `UNPAID → PAID` (inventory deducts on PAID)
- **In-store, utang/partial**: `UNPAID → UNPAID|PARTIALLY_PAID` + `releaseWithBalance=true` (inventory deducts at release)
- **Delivery**:
  - Prepare: `UNPAID → FULFILLMENT.NEW → PICKING → PACKING`
  - **DISPATCHED** (inventory deducts here)
  - `DELIVERED` (proof on paper for now)
  - End-of-day **RemitBatch** → apply collected payments → remaining balances stay PARTIALLY_PAID/UNPAID until cleared
- **Expiry**: UNPAID past `expiryAt` auto-`CANCELLED` (queue janitor)
- **Reprints** do not change state.

---

## Fulfillment (Ticketed or Delivery)

NEW → PICKING → PACKING → DISPATCHED → DELIVERED
↘ ON_HOLD ↗

- **ON_HOLD** for stock/weight mismatches; resolve within fulfillment or escalate to VOID.

---

## Paper

- **Order Ticket** (optional, 57 mm): queue/handover aid.
- **Official Receipt** (57 mm): prints on PAID (or at remit for delivery COD).

---

## Auto-Cancel & Purge

- Auto-cancel `UNPAID` when `expiryAt < now` (not locked or stale lock).
- Purge `CANCELLED` older than 24h.
