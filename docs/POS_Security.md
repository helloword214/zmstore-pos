# POS Security & Permissions

> 📌 Purpose:  
> Documents **roles, permissions, and authority rules** (cashier, manager, picker, auditor).
>
> 🛠 When to update:
>
> - If new role is added.
> - If discount/void permissions change.
> - If PIN or override policies change.
>
> ✅ Readers:
>
> - Developers implementing roles/permissions
> - Managers approving policies
> - Auditors/security team

## Roles

- **Cashier**
  - Can scan slips, apply standard discounts, accept payments, print receipts
- **Manager**
  - Approves manual discounts
  - Authorizes voids
  - Overrides floor-price restrictions
- **Picker/Packer**
  - Handles fulfillment
- **Auditor**
  - Read-only logs

## Rules

- Discounts:
  - Senior/PWD = cashier (with ID check)
  - Manual/override = manager PIN
- Voids:
  - Require reason + manager PIN
- Inventory:
  - Deduct only on PAID
  - Reverse only on VOID
