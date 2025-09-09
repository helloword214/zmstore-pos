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

# POS Credit Flow (Utang Management)

## Overview

- This document defines how credit (utang) and partial payments are handled in the POS system.
  It separates three types of documents/receipts:

  1. Credit Acknowledgment Receipt – proof that goods were released without full payment.

  2. Payment Acknowledgment Receipt – proof of a payment made toward an outstanding balance.

  3. Statement of Account (SOA) – summary of all credit + payments per customer.

## 1. Credit Acknowledgment Receipt

- Issued when goods leave the store without full payment.

- Trigger: Order is released while still UNPAID or PARTIALLY_PAID.

- Contains:

  - Order details (items, qty, price, total)

  - Customer info (name, alias, phone)

  - Total credited balance

  - Due date (if set)

  - Approver (if release-with-balance was authorized)

  ** 📄 Purpose: This is the utang slip. It documents that the store extended credit for this order. **

## 2. Payment Acknowledgment Receipt

- Issued when a customer makes a payment (partial or full).

- Trigger: A new record is added in the Payment table.

- Contains:

  - Order reference

  - Payment amount + method (Cash, GCash, etc.)

  - Running balance (after this payment)

  - Timestamp of payment

* 📄 Purpose: This is the payment slip. It provides proof of each installment or settlement.

## 3. Statement of Account (SOA)

- Generated per customer, not per order.

- Contains:

  - List of all credited orders

  - List of all payments made

  - Total outstanding balance

- Typically used for monthly reconciliation or follow-up.

* 📄 Purpose: This is the long-term account record. It’s not printed by default after a transaction, but can be requested.

## Flow Summary

1. Order released on credit → Print Credit Acknowledgment Receipt.

2. Customer makes payment → Print Payment Acknowledgment Receipt.

3. Store wants summary per customer → Generate Statement of Account.

## Notes

1.  Reprinting:

- Credit Ack can be reprinted any time from the order page.

- Payment Ack can be reprinted from the payment record.

2.  Balances:

- Always computed from Order.totalBeforeDiscount - SUM(Payments.amount).

- Credit flag (Order.isOnCredit) ensures order is tracked.

3. Future:

- SOA module can export to PDF/Excel for external reporting.

---

# Pick-up / In-store flow

Scenario A – Pay now →
Official Receipt agad (57mm).

Scenario B – Utang / Partial →
Credit Acknowledgment Receipt (utang slip).

Scenario C – Partial Payment after release →
Payment Acknowledgment Receipt for each hulog.

👉 Sa cashier ang papel na hawak palagi ay OR (paid) or Ack receipts (utang/payment).

## Delivery flow

Scenario A – Prep/Dispatch →
Delivery Ticket ang hawak ng rider/staff (pang-handover & pang-stub).

May items, qty, presyo (snapshot),

Space para sa “Received by” signature,

LPG notes (empties returned, loaned, upgrade).

Scenario B – Doorstep payment

Kung full paid → rider collects cash, pero receipt proper (Official Receipt) hindi na sa rider – nai-issue at Remit sa cashier pagbalik.

Kung partial/utang → rider marks collection, then cashier generates Payment Ack / Credit Ack pag na-encode sa remit.

👉 Sa rider/staff ang papel ay Delivery Ticket, hindi OR (OR centralized sa cashier para official numbering/printing).

## Core difference

Pick-up: customer walks away na may official/ack receipt.

Delivery: customer gets a Delivery Ticket stub muna; official receipts/acks are only printed once rider remits at cashier.
