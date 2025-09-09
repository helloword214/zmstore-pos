# POS_BusinessPlan.md

## 📌 Purpose

Describes the big-picture business logic of the POS. Explains why the system behaves this way, not just how to code it.

## 🛠 When to update

- When a new rule is added (discount policy, delivery rules, LPG swap).

- When a milestone is completed (add to “Milestones Applied”).

- When a decision is reversed (strike old, add new with date).

## ✅ Readers

- Self-taught devs & future devs

- Cashiers/managers

- Non-technical stakeholders

- Naming (2025-08)

- “Slip” → Order Ticket (paper is optional).

- “Kiosk” → Order Pad (tablet cart page).

## Vision

- Retail + LPG with simple, fast flows:

- Order Pad → Cashier → (optional) Ticket → Payment/Receipt → Fulfillment

- Delivery/COD supported with end-of-day remittance.

## Core Principles

1. **Order creation does not deduct inventory**.  
   Inventory is deducted **when goods leave the store**:

   - In-store handover → when cashier completes or approves release with balance (utang).
   - Delivery → when order is **DISPATCHED** to a delivery agent.

2. **Paper is optional**.  
   You can **Create Order** without printing OR **Create & Print Ticket** (57 mm). Receipts print when fully paid or at settlement (remit).

3. **Discounts are flexible and amount-based**.  
   Not fixed percentages. Approval is required when discount would breach **floor price** (per SKU guardrail based on cost).

4. **Utang (on-credit)** is first-class.  
   Orders can be released with a balance (manager approval logged). Payments can be posted later (partial or full), moving the order to **PARTIALLY_PAID** then **PAID**.

5. **Delivery supports “pasabay” items**, LPG swap/upgrade fees, and cylinder loans. End-of-day **RemitBatch** closes COD/credit deliveries and prints receipts for settled orders.

## Scenarios We Support

- **In-store, pay now** → create order → take cash/card → print official receipt (57 mm).
- **In-store, utang or partial** → create order → record ₱ received (optional) → **release with balance** → print Charge Invoice → later collect payments and print simple payment receipts; mark PAID when balance reaches 0.
- **Delivery (COD)** → prepare, dispatch (deducts stock), deliver, remit end-of-day to cashier → mark PAID and print receipt.
- **Delivery (utang/partial)** → same as COD but remit partial/no cash; order remains PARTIALLY_PAID/UNPAID until cleared.
- **LPG**: refill, swap (brand change), upgrade fee; cylinder loans ledger (borrowed/returned).

## Discounts (Simple & Safe)

- **Discount = Peso amount** (per line or per order).
- **Floor price guardrail** (per SKU): don’t allow below computed minimum (e.g., `dealerPrice / packingSize` for retail, or `dealerPrice` for pack).
- **Manager PIN** required to override floor or to apply large order-level discounts.
- Later we can attach **customer-specific discounts** (loyalty/tiers) but for now it’s ad-hoc with approval.

## LPG — “Catgas Family” Simplification (Option A)

- Treat local pull-valve brands (e.g., Gerona, MDS, Island Gas, Regasco) as one stock pool (“Catgas family”) for cylinder tracking and exchanges.

- Brand at sale only affects price printed on receipt (line snapshot stores brandAtSale).

- Swaps/Upgrades:

- Swap (catgas ↔ catgas): no fee (usually), same stock pool.

- Upgrade to Branded (e.g., Petron/Solane): upgrade fee line item.

- Cylinder Loan: if customer lacks an empty, record a loan (no cash) and track return later.

## Delivery & Remittance

- Delivery ticket can be printed; inventory is deducted at DISPATCHED.

- Rider/store staff collects cash on doorstep (full or partial only with approval).

- Remit Batch at end of shift/day: reconcile collected amounts → orders move to PAID (or remain PARTIALLY_PAID if balance remains).

- No electronic POD yet; use paper stubs (received/borrowed slip), then encode outcomes at cashier.

## Customer Basics (for today; extensible later)

- Customer: split name fields, phone, notes.

- CustomerAddress: address text + optional geo (lat/lng) for delivery reference.

- Use for future loyalty/utang/discount lists.

## Milestones Applied

M1 — Order Ticket (UNPAID): create order from Order Pad; optional print; ticket expires in 24h; reprint counter.

M2 — Cashier Queue & Locking: open by code; TTL locking; auto-cancel expired; purge CANCELLED>24h; delete accidental tickets.

M3 — Payment & Receipt: partial payments supported; per-payment receipts; final receipt on PAID.

M4 — Fulfillment: in-store bagging; delivery NEW→PICKING→PACKING→DISPATCHED→DELIVERED; cylinder swap/loan notes.

## Paper Sizes & UX Copy

- Tickets/Receipts are designed for **57 mm** thermal.
- “Retail empty — open **{packUnit}** needed” (dynamic copy) e.g., sack/tank.
- Avoid jargon; keep labels simple (“Change”, “Paid”, “Balance left”, “Deliver to”).

## Cleanup & Queue Health

- **Auto-cancel** UNPAID orders after expiry (24h).
- **Purge CANCELLED** older than 24h.
- Cashier queue shows **oldest first**, with **locking TTL** (5 min).

## Out of Scope (now)

- Full customer loyalty points

- Electronic POD

- Real-time GPS/dispatch

Business flow (exactly how we’ll use it—no code)

Address picker (Channel=Delivery):

If Select existing address:

Copy address.landmark → order.deliverLandmark

If may photoUrl/Key sa address, copy to order.deliverPhoto\* (snapshot).

If Add new:

Puwedeng mag-upload photo; ito’y mase-save sa CustomerAddress at then i-copy rin to order snapshot.

If Use once (don’t save):

Optional upload → save only to Order.deliverPhoto\* (snapshot lang; walang bagong CustomerAddress).

Saan makikita ang photo:

PACKING/DISPATCH screen: show thumbnail; click = full view (para bago pa umalis si rider, familiar na).

Delivery Ticket (57mm): landmark text lang ang naka-print.
Photo is optional; hindi natin ipi-print para mabilis at malinaw ang resibo. (Kung gusto mo ng QR to photo later, madali nang idagdag.)

Remit view: optional thumbnail para mabilis ma-recall kung saan ang bahay.

Bakit hiwalay ang text at photo?

Text (deliverLandmark) ay laging readable kahit walang data/signal;

Photo (deliverPhotoUrl) ay bonus visual cue—tinutulungan ang bagong rider bago pa umalis, or ma-upload ng staff “pag wala pa”.
