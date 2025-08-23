# POS Fulfillment Rules

> 📌 Purpose:  
> Documents **post-payment workflow**: picking, packing, weighing, handover.
>
> 🛠 When to update:
>
> - If fulfillment steps change (e.g., auto-weighing, partial fulfillment).
> - If SLA times change.
> - If new exceptions or rules (e.g., abandoned order handling).
>
> ✅ Readers:
>
> - Store staff / pickers / packers
> - Developers coding fulfillment states
> - Managers monitoring SLA

---

## States

- `NEW → PICKING → PACKING → READY_FOR_PICKUP → HANDED_OVER → ON_HOLD`

---

## Process

1. Payment completed → Pick Ticket prints.
2. Picker retrieves items.
3. Packer bags/weighs items.
   - **Open Sack Rule**: open one sack → convert to retail stock.
   - **Weighing**: actual weight noted; v1 charges ordered qty.
4. Items labeled + claim stub printed.
5. Order moves to `READY_FOR_PICKUP`.
6. Customer shows slip/stub → staff scans → `HANDED_OVER`.

---

## Exceptions

- **Stock Shortage** → set `ON_HOLD`, notify manager.
- **Mismatch at Counter** → return to `PACKING`.
- **Abandoned Orders** → mark `UNCLAIMED` after X hours (e.g., end of day).

---

## Example Bag Label

Order: 8K3J5Q
Item: Rice 1kg
Packed: 2025-08-23 11:35
Packed by: John

## ON_HOLD — Rules & Resolution

> 🔎 Definition: `ON_HOLD` is an **operations issue after payment** (picking/packing stage), e.g., stock shortage discovered, wrong item pulled, or weighing problem.

### What NOT to do

- ❌ Do **not** send the order back to cashier.
- ❌ Do **not** create a new order automatically.

### Correct Actions

1. **Try to resolve within fulfillment** (no cashier involved):

   - Pull from alternate location/bin.
   - Open a new sack (convert packing → retail stock).
   - Substitute with the **same SKU** from another batch/lot.
   - Re‑weigh and repack.

2. **If resolved** → move the order **back to PICKING/PACKING** and continue:

   - `ON_HOLD → PICKING` (if you need to repick)
   - `ON_HOLD → PACKING` (if only re-bagging/weight fix)
   - Then `READY_FOR_PICKUP → HANDED_OVER`.

3. **If NOT resolvable** (no stock, customer refuses alternatives):
   - Manager performs **VOID** (post‑payment):
     - Requires **reason + PIN**.
     - System creates **reversal entries** (refund) and **restores stock**.
     - Order ends as `VOIDED`.
   - If customer still wants different items → **start a new order** manually.

### Audit

- Log `onHoldReason`, attempts taken, who resolved (pickedBy/packedBy), timestamps.
- If VOID: record refund method and reference.
