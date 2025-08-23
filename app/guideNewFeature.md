# POS Order & Payment Flow (Business Plan)

## 🎯 Goal

Provide a smooth **kiosk → cashier → receipt → fulfillment** workflow, similar to fast-food style ordering (e.g., Jollibee, McDonald’s), but adapted for retail (rice, feeds, pet food, etc.).

---

## 1. Roles & Modes

- **Customer / Kiosk mode**

  - Build order (choose products).
  - Print **Order Slip** (NOT PAID).
  - Bring slip to cashier.

- **Cashier / Counter mode**
  - Sees all **UNPAID orders** in queue.
  - Scans slip (barcode/QR) or searches by ID.
  - Verifies order with customer.
  - Applies discounts (if eligible).
  - Collects payment & prints **Official Receipt**.

---

## 2. Order Lifecycle

### States

- `DRAFT` → optional parked cart.
- `UNPAID` → order slip printed, waiting at cashier.
- `PAID` → cashier confirmed, receipt printed.
- `CANCELLED` → unpaid order invalidated.
- `VOIDED` → paid order reversed (needs reason & authority).

### Flow

1. **Kiosk / Staff builds order**

   - Items + quantities + regular prices.
   - Subtotal & total (before discounts).
   - Print **Order Slip** (with Order ID + QR/Barcode).
   - Save order as **UNPAID** in DB.

2. **Customer brings slip to cashier**

   - Cashier scans slip, retrieves order.

3. **Cashier verification**

   - Confirms items with customer.
   - Can **add/remove items** if needed.
   - Applies **discounts**:
     - Senior / PWD
     - Promo / Membership
     - Manager override (requires PIN)
   - Logs `discountType`, `amount`, `appliedBy`.

4. **Payment**

   - Accept cash, GCash, card, split payments.
   - On full payment → status `PAID`.
   - Print **Official Receipt**.
   - (Optional) Trigger cash drawer open.

5. **Fulfillment**
   - Staff prepares and serves items.
   - Inventory deducted only after **PAID**.

---

## 3. Discounts Policy

- **Kiosk:** NO discounts applied, only regular prices.
- **Cashier:** Sole authority to apply discounts.
- **Audit trail:** Every discount must record:
  - Type (promo, senior, manual)
  - Amount/percent
  - AppliedBy (staffId)
  - Verified with customer (e.g., senior ID shown)

---

## 4. Receipts & Slips

- **Order Slip (Customer Copy)**

  - Header: "ORDER SLIP — NOT PAID"
  - Order No + QR/Barcode
  - Items + qty + unit price
  - Subtotal & total (before discounts)
  - Note: “Please pay at cashier”

- **Official Receipt (After Payment)**
  - Only generated on `PAID` status
  - Includes discounts, taxes, payment method
  - Legally binding record
  - Cannot be modified, only voided (with reason)

---

## 5. Data Retention & Cleanup

- **PAID orders:** Kept permanently (immutable, audit).
- **UNPAID / DRAFT:** Auto-expire & cancel after 24–72h.
- **Slips:** Expire after 7 days.
- **Voids:** Keep original + reversal entry, never delete.

---

## 6. Stock Behavior

- **Deduct inventory only on `PAID`.**
- `UNPAID` slips do not affect stock.
- `VOIDED` → reverse inventory deduction.

---

## 7. Optional Enhancements

- Queue view at cashier (all UNPAID).
- Receipt numbers auto-increment & unique per branch.
- Multi-payment support (cash + e-wallet).
- Nightly sales rollups for reports.
- Cash drawer integration.

---

## 8. Security & Authority

- Discounts require cashier or manager authority.
- Voids require reason + PIN.
- Every action logs `who`, `when`, `why`.

---

## ✅ Key Rules

- Kiosk prints **Order Slip with total (no discount)**.
- Cashier is the **only one to finalize discounts**.
- Official Receipt only after **PAID**.
- Inventory moves only after **PAID**.
