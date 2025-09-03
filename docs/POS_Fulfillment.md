# POS Fulfillment Rules

> **Purpose**  
> Picking/Packing/Dispatch/Delivery rules for ticketed/delivery orders.

---

## States

`NEW → PICKING → PACKING → DISPATCHED → DELIVERED`  
`ON_HOLD` for exceptions (stock/weight mismatch, wrong item).

- **DISPATCHED**: inventory deducted (goods leave store).
- **DELIVERED**: proof on paper (for now); later we can capture digital.

---

## Delivery Notes

- **Pasabay** items are allowed with LPG.
- LPG rules during PACKING:
  - Refill line item; if **swap** to different brand within CatGas → no cylinder fee by policy.
  - **Upgrade** to branded cylinder → charge **upgrade fee** line.
  - **Cylinder Loan** if customer borrows an empty (open a loan record).

---

## In-Store Handover (no delivery)

- If the customer **pays now**: deduct on **PAID**.
- If **utang/partial**: use **Release with Balance** (manager approved), deduct on release, print **Charge Invoice**.

---

## ON_HOLD Resolution

- Try to resolve within fulfillment (re-pick/re-pack, open sack/tank).
- If not resolvable → escalate to **VOID** (manager), restock and refund any payments.
