# Guide Index

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-22

This folder contains both binding rules and historical implementation notes.
Use the sections below to avoid outdated references.

## A. Canonical (Binding)

Use these as source of truth for implementation and review:

1. `Commercial Clearance System V2`
2. `CANONICAL_ORDER_PRICING_SOT.md`
3. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
4. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
5. `DIAGRAMS_DELIVERY_CSS_AR.md`
6. `Accounts Receivable — Canonical Source of Truth (SoT)`
7. `RIDER_SHORTAGE_WORKFLOW.md`
8. `RunReceipt_Architecture.md`

Current route-level mapping coverage (canonical):

1. `pad-order._index.tsx`
2. `orders.new.tsx`
3. `customers.$id.pricing._index.tsx`
4. `customers.$id.pricing.$ruleId.tsx`
5. `store.dispatch.tsx`
6. `runs.$id.dispatch.tsx`
7. `runs.$id.summary.tsx`
8. `runs.$id.rider-checkin.tsx`
9. `store.clearance.tsx`
10. `store.clearance_.$caseId.tsx`
11. `runs.$id.remit.tsx`
12. `cashier.delivery._index.tsx`
13. `cashier.delivery.$runId.tsx`
14. `delivery-remit.$id.tsx`
15. `ar._index.tsx`
16. `ar.customers.$id.tsx`
17. `cashier.shift.tsx`
18. `store.cashier-shifts.tsx`
19. `store.cashier-variances.tsx`
20. `cashier.charges.tsx`
21. `store.cashier-ar.tsx`
22. `store.payroll.tsx`

## B. Supporting (Context / Detailed Rationale)

1. `Clearance CSS Alignment Rules.md`
2. `Remit_Cleanup_Checklist.md`
3. `../ui-automation/README.md`
4. `../ui-automation/INTENT_ROUTER.md`
5. `../ui-automation/UI_CYCLE_RUNBOOK.md`
6. `../ui-automation/BUSINESS_FLOW_SMOKE_RUNBOOK.md`

These help implementation but must not override Canonical docs.

## C. Deprecated or Plan-Only (Do Not Use as Authority)

See `../archive/README.md` for the current deprecation list and superseding docs.
Archived guide files now live under `../archive/guide/`.

## D. Conflict Rule inside `docs/guide`

When two guide docs conflict, apply this order:

1. `Commercial Clearance System V2`
2. `CANONICAL_ORDER_PRICING_SOT.md`
3. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
4. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
5. `DIAGRAMS_DELIVERY_CSS_AR.md`
6. `Accounts Receivable — Canonical Source of Truth (SoT)`
7. `RIDER_SHORTAGE_WORKFLOW.md`
8. all other guide docs

## E. Flow Change Sync Rule (Mandatory)

1. If code changes flow behavior, update the corresponding canonical guide docs in the same objective/PR.
2. Minimum required docs for flow-affecting updates:
   - `CANONICAL_ORDER_PRICING_SOT.md` when order-create pricing/freeze behavior changes
   - relevant `CANONICAL_*.md` flow guide
   - `DIAGRAMS_DELIVERY_CSS_AR.md` when flow nodes/handoffs/decision gates changed
3. Manager/cashier flow changes must not be considered complete until both behavior doc and diagram doc are aligned.
