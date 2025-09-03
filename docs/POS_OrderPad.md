# Order Pad UI (Tablet-First) _(formerly “Kiosk”)_

> **Purpose**  
> Fast cart building for staff, with optional ticket printing.

---

## Goals

- Quick item add; mixed Retail/Pack lines where allowed.
- Prevent bad submissions via client preflight (mirrors server rules).
- Keep data fresh with light polling + focus revalidate.

---

## Availability Rules

- **Retail**: requires `allowPackSale = true`, `packingStock > 0`, `price > 0`.
- **Pack**: requires `stock > 0`, `srp > 0`.
- Card dims only when **both** unavailable.

**Copy:**

- “Retail empty — open **{packUnit}** needed” (uses `packingUnit` name—e.g., _sack_, _tank_).
- “Pack stock empty”.

---

## Quantity Steps

- Retail step = **0.25**
- Pack step = **1**

---

## Create Order / Print

Primary button toggles:

- **Create Order** (no print) → navigate `/orders/:id/ticket`
- **Create & Print Ticket** → navigate `/orders/:id/ticket?autoprint=1&autoback=1`

Ticket page has **single guarded auto-print** using `afterprint` and a ref to avoid duplicate dialogs.

---

## Client Preflight (mirrors server)

- Retail: allowPackSale, price>0, qty multiple of 0.25, qty≤packingStock, unitPrice===price.
- Pack: srp>0, qty integer, qty≤stock, unitPrice===srp.
- Mixed-mode allowed (same product appears twice: retail + pack).

---

## Accessibility

- Modal has focusable backdrop; ESC closes.
- Buttons have `title` explaining disabled reason.
- Inputs have correct `min`, `max`, `step`.
