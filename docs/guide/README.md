# Guide Index

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-24

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
3. `customers.$id_.pricing.tsx`
4. `customers.$id_.pricing_.$ruleId.tsx`
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

1. `ui/README.md`
2. `ui/UI_SOT.md`
3. `ui/UI_AUTOMATION_GUIDE.md`
4. `ui/UI_CONFORMANCE_MATRIX.md`
5. `ui/UI_REPAIR_AUTOMATION_RUNBOOK.md`
6. `ui/Clearance CSS Alignment Rules.md`
7. `ui/Remit_Cleanup_Checklist.md`
8. `../automation/runbooks/README.md`
9. `../automation/runbooks/INTENT_ROUTER.md`
10. `../automation/runbooks/UI_CYCLE_RUNBOOK.md`
11. `../automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
12. `../automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md`

These help implementation but must not override Canonical docs.

Monitor/repair split rule:

1. `ui:cycle` is monitor-only (detect/classify/report).
2. UI code edits belong to repair flow/runbook.
3. Repeated route patterns should be extracted into SoT UI components first.

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
