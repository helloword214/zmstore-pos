# EPIC: Delivery Dispatch Staging + Rider Loadout

**Goal:** Replace “instant ticket” dispatch with a staging page where cashier assigns a rider + vehicle, adds extra load (e.g., LPG tanks), validates capacity, then dispatches (prints ticket). Keep remit flow unchanged.

## Milestone 1 — Minimal Viable Dispatch Staging

### ✅ Issue 1: New Dispatch Staging page

**Title:** Add `/orders/:id/dispatch` staging page (before ticket)  
**Acceptance:**

- From Cashier delivery order, **Dispatch** opens staging page (no auto-print).
- Page shows order summary (customer, items, totals) + fulfillment notes.
- Buttons: **Save & Stay**, **Dispatch & Print**, **Cancel** (back to Cashier).
- Guard: cannot **Dispatch** until Rider is chosen.

### ✅ Issue 2: Assign Rider (Employee)

**Title:** Rider selector (employees with role=RIDER)  
**Acceptance:**

- Searchable dropdown of employees flagged as Rider.
- Required to dispatch.
- Rider name appears on printed ticket.

### ✅ Issue 3: Select Vehicle

**Title:** Vehicle selector (type + capacity)  
**Acceptance:**

- Dropdown of vehicles (e.g., Tricycle, Motorcycle).
- Shows capacity hint (e.g., “Max LPG: 12”).
- Optional; if not set, use rider’s default vehicle (if configured).

### ✅ Issue 4: Add Extra Load (Loadout)

**Title:** Loadout list for extra stock (e.g., LPG tanks)  
**Acceptance:**

- Add rows: product + quantity (integer by default; allow decimal if product’s retail unit supports it).
- Quick add shortcuts for common items (LPG 11kg, 22kg, etc.).
- Live “capacity used” meter vs vehicle capacity.
- Guard: cannot exceed capacity.

### ✅ Issue 5: Capacity Validation

**Title:** Server + client capacity checks  
**Acceptance:**

- Client-side capacity meter turns red when exceeded.
- Server blocks “Dispatch & Print” when exceeded (nice error).

### ✅ Issue 6: Status + Inventory side-effects

**Title:** Update fulfillment status on staging/dispatch  
**Acceptance:**

- **Save & Stay** → order `fulfillmentStatus = STAGED` (no inventory change).
- **Dispatch & Print** → order `fulfillmentStatus = DISPATCHED`, set `dispatchedAt`, deduct **order items inventory** (unchanged from current logic), and **deduct loadout inventory** at the same time.
- Ticket prints rider + vehicle + loadout.

### ✅ Issue 7: Ticket content update

**Title:** Include Rider / Vehicle / Loadout on Delivery Ticket  
**Acceptance:**

- Ticket shows: Rider name, Vehicle, Loadout lines (product + qty), dispatch date/time.
- Keeps existing customer and order items.

### ✅ Issue 8: Backward compatibility

**Title:** Keep “Reprint Ticket” behavior  
**Acceptance:**

- If already dispatched, **Dispatch** button still opens staging page in **read-only** mode with “Reprint Ticket” action.
- No duplicate deductions on reprint.

---

## Milestone 2 — Loadout Ledger & Reconciliation

### Issue 9: Stock ledger entries for loadout

**Title:** Create “Movement Out: Loadout” on dispatch  
**Acceptance:**

- For each loadout line, create stock movement record (location: main → rider).
- Supports later **return** or **walk-in sale** accounting.

### Issue 10: Post-run return flow (manual)

**Title:** Return unused loadout to store  
**Acceptance:**

- Simple page to record what came back; creates “Movement In: Return”.
- Shows variance (dispatched − sold − returned = expected 0).

---

## Milestone 3 — Delivery Runs (multi-order)

### Issue 11: Delivery Run entity

**Title:** Group multiple orders into one run  
**Acceptance:**

- Create a **Run** with rider, vehicle, loadout, and 1..N orders.
- Dispatch prints a **Run Ticket** with stop list.

### Issue 12: Ad-hoc sales during run

**Title:** Record on-the-road sales against run loadout  
**Acceptance:**

- Minimal UI to sell from run loadout (not tied to a prior order).
- Decrements loadout stock; produces a small receipt and adds to remit totals.

---

## Milestone 4 — Reporting & Controls

### Issue 13: Capacity profiles

**Title:** Vehicle capacity by product category  
**Acceptance:**

- Define capacity per product/tag (e.g., LPG tank units).
- Validation uses category-specific capacity.

### Issue 14: Rider performance & run profitability

**Title:** Reports for runs  
**Acceptance:**

- Per-run summary: orders delivered, ad-hoc sales, fuel/allowance (manual input), gross margin, variance.

### Issue 15: Permissions & overrides

**Title:** Manager override for capacity and loadout  
**Acceptance:**

- Capacity exceed requires manager PIN/name.
- All overrides logged.

---

## Data Model (light, no code)

- **Employee**: add `role` enum or tag (`RIDER`).
- **Vehicle**: `id`, `name`, `type`, `capacityUnits` (default), `notes`.
- **Dispatch/Run** (M1 can store on Order):
  - On Order: `riderId`, `vehicleId`, `loadoutSnapshot (JSON)`, `stagedAt`, `dispatchedAt`, `fulfillmentStatus` (`NEW` → `STAGED` → `DISPATCHED`).
- **StockMovement** (Milestone 2):
  - `type` (`LOADOUT_OUT`, `RETURN_IN`), `productId`, `qty`, `ref` (order/run), `locationFrom/To`.

---

## UX Notes

- Staging page is mobile-friendly (cashier tablet).
- Rider/Vehicle selectors support type-ahead.
- Capacity badge shows **Used / Max**.
- Error copy is plain and actionable.

---

## QA Checklist (per milestone)

- [ ] Can’t dispatch without rider.
- [ ] Capacity over → blocked with clear error (and manager override if enabled).
- [ ] Ticket shows rider/vehicle/loadout.
- [ ] Reprint does not re-deduct.
- [ ] Inventory for loadout is deducted on dispatch; returns restore.
- [ ] Remit flow unaffected.

---

## Out of Scope (future)

- Route optimization / mapping.
- GPS tracking.
- Automatic pricing changes by zone.
