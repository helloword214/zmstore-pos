# Route Cleanup Checklist

Status: ACTIVE  
Owner: POS Platform  
Last Updated: 2026-03-12

## 1. Purpose

Central tracker for route cleanup progress so the team can see, per route, which cleanup tasks are already completed and which are still pending.

Scope in this file is cleanup hardening only:

1. remove route-level `@typescript-eslint/no-explicit-any` bypass
2. reduce/remove `as any` casts
3. remove debug `console.log` traces in active route code

Business behavior changes are out of scope for this checklist.

## 2. Status Legend

1. `DONE`: no current hits for cleanup markers in this route (`no-explicit-any`, `as any`, `console.log`)
2. `PENDING`: route still has one or more cleanup markers
3. `N/A`: route intentionally excluded from this pass (example: generated/internal-only path)

## 3. Baseline Snapshot (2026-03-11)

1. Active routes tracked from UI matrix: `51`
2. `DONE`: `51`
3. `PENDING`: `0`
4. Scan markers:
   - `@typescript-eslint/no-explicit-any`
   - `as any`
   - `console.log`
5. Priority rule for execution:
   - highest marker count first
   - then by flow criticality (`REMIT`/`CHECKIN` routes before lower-risk routes)

## 4. Cleanup Log

1. 2026-03-08 - [PR #47](https://github.com/helloword214/zmstore-pos/pull/47)  
   Scope: legacy/dev route deletion + baseline check restore  
   Merge: `efa3eb85cb2b5b75b8a748d4fe5c3c0ce4af8f22`
2. 2026-03-08 - [PR #48](https://github.com/helloword214/zmstore-pos/pull/48)  
   Scope: compatibility alias route cleanup  
   Merge: `ddd7276963690f3b0ac3f40be632e0b9ae09ec46`
3. 2026-03-10 - [PR #49](https://github.com/helloword214/zmstore-pos/pull/49)  
   Scope: `products._index.tsx` typing/log cleanup  
   Merge: `eaf8a81cffe716887c9a44e7c6787f24154026d4`
4. 2026-03-10 - [PR #50](https://github.com/helloword214/zmstore-pos/pull/50)  
   Scope: `runs._index.tsx` typing cleanup  
   Merge: `e8783a4a983caa4a8de17a91663089f74e8ef7b3`
5. 2026-03-10 - [PR #51](https://github.com/helloword214/zmstore-pos/pull/51)  
   Scope: route cleanup checklist tracker centralization  
   Merge: `5eee63f46de8e7c5a77593bfe8f0bf33203d8b33`
6. 2026-03-10 - [PR #52](https://github.com/helloword214/zmstore-pos/pull/52)  
   Scope: remit/dispatch/shift route typing cleanup  
   Merge: `b69ec7b2af43e00e5746ae44cbbba89315f7a0b5`
7. 2026-03-11 - current batch A (`codex/cleanup-runs-summary`)  
   Scope: `runs.$id.summary.tsx` route-level any/cast cleanup + typed snapshot/case parsing  
   Merge: pending (this branch)
8. 2026-03-11 - current batch B (`codex/cleanup-runs-summary`)  
   Scope: `runs.$id.rider-checkin.tsx` route-level any/cast cleanup + typed loader/action payload parsing  
   Merge: pending (this branch)
9. 2026-03-11 - current batch C (`codex/cleanup-runs-summary`)  
   Scope: `store.cashier-shifts.tsx` route-level any/cast cleanup + enum-safe manager close/resend transaction writes  
   Merge: pending (this branch)
10. 2026-03-11 - current batch D (`codex/cleanup-runs-summary`)  
   Scope: `store.payroll.tsx` route-level any/cast cleanup + enum-safe charge/variance payroll settlement updates  
   Merge: pending (this branch)
11. 2026-03-11 - current batch E (`codex/cleanup-runs-summary`)  
   Scope: `store.clearance-opening-batches.tsx` route-level any/cast cleanup + enum-safe batch decision/case status writes  
   Merge: pending (this branch)
12. 2026-03-11 - current batch F (`codex/cleanup-runs-summary`)  
   Scope: `store.clearance_.$caseId.tsx` route-level any/cast cleanup + typed decision/customer-label payloads and enum-safe write paths  
   Merge: pending (this branch)
13. 2026-03-11 - current batch G (`codex/cleanup-runs-summary`)  
   Scope: `cashier.$id.tsx` route-level any/cast cleanup + typed loader/action payload parsing and clearance settlement guards  
   Merge: pending (this branch)
14. 2026-03-11 - current batch H (`codex/cleanup-runs-summary`)  
   Scope: `store._index.tsx` route-level any/cast cleanup + typed manager dashboard aggregate/grouped metric parsing  
   Merge: pending (this branch)
15. 2026-03-11 - current batch I (`codex/cleanup-runs-summary`)  
   Scope: `orders.new.tsx` route-level any/cast cleanup + typed incoming-order payload parsing and enum-safe order item writes  
   Merge: pending (this branch)
16. 2026-03-11 - current batch J (`codex/cleanup-runs-summary`)  
   Scope: `store.cashier-variances.tsx` route-level any/cast cleanup + typed variance loader filters and denomination parsing  
   Merge: pending (this branch)
17. 2026-03-11 - current batch K (`codex/cleanup-runs-summary`)  
   Scope: `creation.opening-ar-batches.tsx` route-level any/cast cleanup + typed opening-batch grouping and case/claim create payloads  
   Merge: pending (this branch)
18. 2026-03-11 - current batch L (`codex/cleanup-runs-summary`)  
   Scope: `pad-order._index.tsx` route-level any/cast cleanup + typed fetcher reset/customer pick/barcode handling  
   Merge: pending (this branch)
19. 2026-03-11 - current batch M (`codex/cleanup-runs-summary`)  
   Scope: `cashier.charges.tsx` route-level any/cast cleanup + enum-safe variance filters/status close + typed denomination parsing  
   Merge: pending (this branch)
20. 2026-03-11 - current batch N (`codex/cleanup-runs-summary`)  
   Scope: `store.rider-variances.tsx` route-level any/cast cleanup + enum-safe variance filters/transitions + typed manager actor id  
   Merge: pending (this branch)
21. 2026-03-11 - current batch O (`codex/cleanup-runs-summary`)  
   Scope: `rider.variance.$id.tsx` route-level any/cast cleanup + enum-safe rider acceptance checks/transitions  
   Merge: pending (this branch)
22. 2026-03-11 - current batch P (`codex/cleanup-runs-summary`)  
   Scope: `cashier.shift-history.tsx`, `cashier.delivery._index.tsx`, `creation.vehicles.tsx`, `creation.provinces.tsx`, `cashier._index.tsx` route-level any/cast cleanup  
   Merge: pending (this branch)
23. 2026-03-11 - current batch Q (`codex/cleanup-runs-summary`)  
   Scope: `store.clearance.tsx`, `rider.variances.tsx`, `ar.customers.$id.tsx`, `store.cashier-ar.tsx`, `ar._index.tsx` route-level any/cast cleanup  
   Merge: pending (this branch)
24. 2026-03-11 - current batch R (`codex/cleanup-runs-summary`)  
   Scope: `customers.new.tsx`, `customers.$id_.pricing.tsx`, `creation.riders.tsx`, `creation.areas.tsx`, `cashier.pos._index.tsx` route-level any/cast cleanup  
   Merge: pending (this branch)
25. 2026-03-12 - current batch S (`codex/cleanup-runs-summary`)  
   Scope: `rider._index.tsx`, `store.rider-charges.tsx` route-level any/cast cleanup  
   Commit: `97d4b48`  
   Merge: pending (this branch)
26. 2026-03-12 - current batch T (`codex/cleanup-runs-summary`)  
   Scope: `orders.$id.credit.tsx`, `orders.$id.receipt.tsx`, `store.rider-ar.tsx`, `orders.$id.dispatch.tsx`, `ar.customers.$id_.statement.tsx` route-level any/cast cleanup (outside active-route checklist scope)  
   Commit: `76c9928`  
   Merge: pending (this branch)
27. 2026-03-12 - current batch U (`codex/cleanup-runs-summary`)  
   Scope: `resources.creation.upsert.ts`, `resources.creation.delete.ts` route-level any/cast cleanup (resource helper routes; outside active-route checklist scope)  
   Commit: `d18a9de`  
   Merge: pending (this branch)

## 5. Route Checklist (Active Routes)

| Route | Status | Marker Count | Notes |
| --- | --- | --- | --- |
| `app/routes/_index.tsx` | DONE | 0 | cleaned |
| `app/routes/store._index.tsx` | DONE | 0 | cleaned in current batch (typed dashboard metrics + no route-level any bypass) |
| `app/routes/customers._index.tsx` | DONE | 0 | cleaned |
| `app/routes/customers.new.tsx` | DONE | 0 | cleaned in current batch (typed address payload parsing/update assignment + no route-level any bypass) |
| `app/routes/customers.$id.tsx` | DONE | 0 | cleaned |
| `app/routes/customers.$id_.edit.tsx` | DONE | 0 | cleaned |
| `app/routes/customers.$id_.pricing.tsx` | DONE | 0 | cleaned in current batch (typed pricing value formatter + no route-level any bypass) |
| `app/routes/customers.$id_.pricing_.$ruleId.tsx` | DONE | 0 | cleaned |
| `app/routes/creation._index.tsx` | DONE | 0 | cleaned |
| `app/routes/creation.riders.tsx` | DONE | 0 | cleaned in current batch (typed rider where-filter + action error handling) |
| `app/routes/creation.vehicles.tsx` | DONE | 0 | cleaned in current batch (typed vehicle filters + no route-level any bypass) |
| `app/routes/creation.provinces.tsx` | DONE | 0 | cleaned in current batch (typed province filters + no route-level any bypass) |
| `app/routes/creation.areas.tsx` | DONE | 0 | cleaned in current batch (typed action error handling + no route-level any bypass) |
| `app/routes/creation.opening-ar-batches.tsx` | DONE | 0 | cleaned in current batch (typed opening-batch grouping + case/claim payload writes) |
| `app/routes/products._index.tsx` | DONE | 0 | cleaned in PR #49 |
| `app/routes/products.new.tsx` | DONE | 0 | cleaned |
| `app/routes/products.$productId.tsx` | DONE | 0 | cleaned |
| `app/routes/products.$productId.edit.tsx` | DONE | 0 | cleaned |
| `app/routes/login.tsx` | DONE | 0 | cleaned |
| `app/routes/cashier._index.tsx` | DONE | 0 | cleaned in current batch (enum-safe cashier charge counts + typed payment aggregation) |
| `app/routes/cashier.pos._index.tsx` | DONE | 0 | cleaned in current batch (typed queue delete-slip error handling + no route-level any bypass) |
| `app/routes/orders.new.tsx` | DONE | 0 | cleaned in current batch (typed incoming payload validation + enum-safe create payloads) |
| `app/routes/pad-order._index.tsx` | DONE | 0 | cleaned in current batch (typed fetcher/customer/barcode handling + no route-level any bypass) |
| `app/routes/cashier.$id.tsx` | DONE | 0 | cleaned in current batch (typed settlement/clearance flow + no route-level any bypass) |
| `app/routes/rider._index.tsx` | DONE | 0 | cleaned in current batch (enum-safe rider role gate + typed payment aggregation; no route-level any bypass) |
| `app/routes/store.dispatch.tsx` | DONE | 0 | cleaned (typed dispatch filters/orderBy + UI state mapping) |
| `app/routes/runs._index.tsx` | DONE | 0 | cleaned in PR #50 |
| `app/routes/runs.new.tsx` | DONE | 0 | cleaned |
| `app/routes/runs.$id.dispatch.tsx` | DONE | 0 | cleaned (typed loadout snapshot parsing + enum-safe revert/dispatch updates) |
| `app/routes/runs.$id.summary.tsx` | DONE | 0 | cleaned in current batch (typed summary loader parsing) |
| `app/routes/runs.$id.rider-checkin.tsx` | DONE | 0 | cleaned in current batch (typed receipt/checkin loader+action parsing) |
| `app/routes/store.clearance.tsx` | DONE | 0 | cleaned in current batch (enum-safe clearance-case filter + typed walk-in/delivery mapping) |
| `app/routes/store.clearance_.$caseId.tsx` | DONE | 0 | cleaned in current batch (typed decision lane + no route-level any bypass) |
| `app/routes/runs.$id.remit.tsx` | DONE | 0 | cleaned (typed clearance/status handling in remit loader/action) |
| `app/routes/cashier.delivery._index.tsx` | DONE | 0 | cleaned in current batch (typed remit list row/cash-map parsing + no route-level any bypass) |
| `app/routes/cashier.delivery.$runId.tsx` | DONE | 0 | cleaned (typed remit helpers, no route-level any bypass) |
| `app/routes/delivery-remit.$id.tsx` | DONE | 0 | cleaned (typed freeze-line mapping + enum-safe remit writes) |
| `app/routes/ar._index.tsx` | DONE | 0 | cleaned in current batch (removed route-level any bypass) |
| `app/routes/ar.customers.$id.tsx` | DONE | 0 | cleaned in current batch (enum-safe A/R status updates + typed error handling) |
| `app/routes/cashier.shift.tsx` | DONE | 0 | cleaned (typed shift status/drawer tx + isolation enum handling) |
| `app/routes/cashier.shift-history.tsx` | DONE | 0 | cleaned in current batch (enum-safe shift status filters + typed cash-count parsing) |
| `app/routes/store.cashier-shifts.tsx` | DONE | 0 | cleaned in current batch (typed shift aggregates + enum-safe actions) |
| `app/routes/store.cashier-variances.tsx` | DONE | 0 | cleaned in current batch (typed variance status filters + denomination parsing) |
| `app/routes/cashier.charges.tsx` | DONE | 0 | cleaned in current batch (enum-safe variance filters/status updates + typed denomination parsing) |
| `app/routes/store.cashier-ar.tsx` | DONE | 0 | cleaned in current batch (typed cashier identity mapping + no route-level any bypass) |
| `app/routes/store.payroll.tsx` | DONE | 0 | cleaned in current batch (typed payroll deduction settlement + variance sync) |
| `app/routes/store.rider-variances.tsx` | DONE | 0 | cleaned in current batch (enum-safe variance filters/transitions + typed manager actor id) |
| `app/routes/rider.variances.tsx` | DONE | 0 | cleaned in current batch (typed session actor + enum-safe rider variance filters) |
| `app/routes/rider.variance.$id.tsx` | DONE | 0 | cleaned in current batch (typed rider actor mapping + enum-safe acceptance checks/transitions) |
| `app/routes/store.rider-charges.tsx` | DONE | 0 | cleaned in current batch (removed route-level any bypass) |
| `app/routes/store.clearance-opening-batches.tsx` | DONE | 0 | cleaned in current batch (typed opening-batch decision lane + status transitions) |

## 6. Operating Rules

1. One cleanup objective = one commit.
2. Every touched route must update this checklist in the same PR.
3. Every touched route must update `UI_CONFORMANCE_MATRIX.md` note in the same PR.
4. `CHECK` must stay green:
   - `npm run typecheck`
   - `npm run lint`

## 7. Next Recommended Batch

Active-route cleanup in this checklist is complete (`PENDING: 0`).

Recommended follow-up (outside active-route checklist scope):

1. None

Reason: no remaining cleanup markers (`no-explicit-any`, `as any`, `console.log`) in `app/routes`.
