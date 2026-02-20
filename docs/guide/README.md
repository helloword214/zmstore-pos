# Guide Index

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-20

This folder contains both binding rules and historical implementation notes.
Use the sections below to avoid outdated references.

## A. Canonical (Binding)

Use these as source of truth for implementation and review:

1. `Commercial Clearance System V2`
2. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
4. `DIAGRAMS_DELIVERY_CSS_AR.md`
5. `Accounts Receivable — Canonical Source of Truth (SoT)`
6. `RIDER_SHORTAGE_WORKFLOW.md`
7. `RunReceipt_Architecture.md`

Current route-level mapping coverage (canonical):

1. `store.dispatch.tsx`
2. `runs.$id.dispatch.tsx`
3. `runs.$id.summary.tsx`
4. `runs.$id.rider-checkin.tsx`
5. `store.clearance.tsx`
6. `store.clearance_.$caseId.tsx`
7. `runs.$id.remit.tsx`
8. `cashier.delivery._index.tsx`
9. `cashier.delivery.$runId.tsx`
10. `delivery-remit.$id.tsx`
11. `ar._index.tsx`
12. `ar.customers.$id.tsx`
13. `cashier.shift.tsx`
14. `store.cashier-shifts.tsx`
15. `store.cashier-variances.tsx`
16. `cashier.charges.tsx`
17. `store.cashier-ar.tsx`
18. `store.payroll.tsx`

## B. Supporting (Context / Detailed Rationale)

1. `Clearance CSS Alignment Rules.md`
2. `Remit_Cleanup_Checklist.md`

These help implementation but must not override Canonical docs.

## C. Deprecated or Plan-Only (Do Not Use as Authority)

See `../archive/README.md` for the current deprecation list and superseding docs.
Archived guide files now live under `../archive/guide/`.

## D. Conflict Rule inside `docs/guide`

When two guide docs conflict, apply this order:

1. `Commercial Clearance System V2`
2. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
4. `DIAGRAMS_DELIVERY_CSS_AR.md`
5. `Accounts Receivable — Canonical Source of Truth (SoT)`
6. `RIDER_SHORTAGE_WORKFLOW.md`
7. all other guide docs

## E. Flow Change Sync Rule (Mandatory)

1. If code changes flow behavior, update the corresponding canonical guide docs in the same objective/PR.
2. Minimum required docs for flow-affecting updates:
   - relevant `CANONICAL_*.md` flow guide
   - `DIAGRAMS_DELIVERY_CSS_AR.md` when flow nodes/handoffs/decision gates changed
3. Manager/cashier flow changes must not be considered complete until both behavior doc and diagram doc are aligned.
