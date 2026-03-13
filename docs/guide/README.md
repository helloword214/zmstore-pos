# Guide Index

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-03-13

This file is a router for `docs/guide`.
It points readers to owner documents and must not become a secondary specification.

Documentation architecture reference:

1. `docs/Governance SOP/Documentation Architecture Standard.md`

## 0. How To Use This Folder

1. Start with the concern you are answering.
2. Open the owner document for that concern first.
3. Use diagram and supporting docs only after reading the owner doc.
4. If two docs appear to define the same rule, prefer the owner doc listed here.

## A. Canonical (Binding)

Use these as source of truth for implementation and review:

1. `Commercial Clearance System V2`
2. `CANONICAL_IDENTITY_ACCESS_FLOW.md`
3. `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`
4. `CANONICAL_UPLOAD_STORAGE_SOT.md`
5. `CANONICAL_ORDER_PRICING_SOT.md`
6. `CANONICAL_PRODUCTLIST_SHAPE_SOT.md`
7. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
8. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
9. `Accounts Receivable — Canonical Source of Truth (SoT)`
10. `RIDER_SHORTAGE_WORKFLOW.md`
11. `RunReceipt_Architecture.md`

## B. Owner Doc Map

Use this map to route by concern.

| Concern | Owner document | Notes |
| --- | --- | --- |
| Role boundaries, route access, identity model | `CANONICAL_IDENTITY_ACCESS_FLOW.md` | Owner for role authority and access boundaries |
| Worker schedule planning, staffing exceptions, rider duty gating | `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md` | Owner for schedule/event-log/duty-session separation and cashier schedule boundary |
| Upload/storage contract | `CANONICAL_UPLOAD_STORAGE_SOT.md` | Owner for file storage, keying, validation, lifecycle |
| Order pricing freeze and creator audit anchors | `CANONICAL_ORDER_PRICING_SOT.md` | Owner for pricing freeze authority |
| Product unit/pack/retail shape | `CANONICAL_PRODUCTLIST_SHAPE_SOT.md` | Owner for product sell-shape and stock semantics |
| End-to-end delivery -> cashier -> AR workflow | `CANONICAL_DELIVERY_CASH_AR_FLOW.md` | Owner for stage handoffs and route-stage mapping |
| Cashier shift close, recount, variance, charge | `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` | Owner for cashier drawer accountability lifecycle |
| Customer AR ledger and payment SoT | `Accounts Receivable — Canonical Source of Truth (SoT)` | Owner for AR ledger semantics |
| Commercial clearance rules | `Commercial Clearance System V2` | Owner for clearance decision authority |
| Rider shortage flow | `RIDER_SHORTAGE_WORKFLOW.md` | Owner for rider-accountability workflow |
| Run receipt structure | `RunReceipt_Architecture.md` | Owner for run receipt architecture |
| Flow visualization and handoff diagram | `DIAGRAMS_DELIVERY_CSS_AR.md` | Diagram only; use canonical docs for binding rules |

Quick lookup reminders:

1. security access targets and retired legacy order settlement routes -> `CANONICAL_IDENTITY_ACCESS_FLOW.md`
2. worker schedule planning, staffing event history, and rider duty gating -> `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`
3. clearance pending counter, legacy receipt-route retirement, and print artifact boundaries -> `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
4. cashier recount + paper reference + signed paper audit artifact -> `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
5. creator audit anchors -> `CANONICAL_ORDER_PRICING_SOT.md`

## C. Diagrams / Visual Maps

These visualize flow and route ownership but do not replace canonical owner docs.

1. `DIAGRAMS_DELIVERY_CSS_AR.md`

## D. Supporting (Context / Detailed Rationale)

1. `ui/README.md`
2. `ui/UI_SOT.md`
3. `ui/UI_AUTOMATION_GUIDE.md`
4. `ui/UI_CONFORMANCE_MATRIX.md`
5. `ui/UI_REPAIR_AUTOMATION_RUNBOOK.md`
6. `ui/Clearance CSS Alignment Rules.md`
7. `ui/Remit_Cleanup_Checklist.md`
8. `ui/ROUTE_CLEANUP_CHECKLIST.md`
9. `../automation/runbooks/README.md`
10. `../automation/runbooks/INTENT_ROUTER.md`
11. `../automation/runbooks/UI_CYCLE_RUNBOOK.md`
12. `../automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
13. `../automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md`
14. `PRODUCTLIST_REFACTOR_DIRECTION.md`
15. `PRODUCTLIST_REFACTOR_DECISION_LOG.md`
16. `PRODUCTLIST_REFACTOR_ROADMAP_CHECKLIST.md`

These help implementation but must not override Canonical docs.

Monitor/repair split rule:

1. `ui:cycle` is monitor-only (detect/classify/report).
2. UI code edits belong to repair flow/runbook.
3. Repeated route patterns should be extracted into SoT UI components first.

## E. Draft / Planned

No active draft in this folder currently owns a pending business-flow decision.

## F. Deprecated or Plan-Only (Do Not Use as Authority)

See `../archive/README.md` for the current deprecation list and superseding docs.
Archived guide files now live under `../archive/guide/`.

Superseded pointer retained for trace only:

1. `WORKER_SCHEDULING_DUTY_SESSION_DRAFT.md` -> superseded by `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## G. Conflict Rule inside `docs/guide`

When two guide docs conflict, apply this order:

1. `Commercial Clearance System V2`
2. `CANONICAL_IDENTITY_ACCESS_FLOW.md`
3. `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`
4. `CANONICAL_UPLOAD_STORAGE_SOT.md`
5. `CANONICAL_ORDER_PRICING_SOT.md`
6. `CANONICAL_PRODUCTLIST_SHAPE_SOT.md`
7. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
8. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
9. `Accounts Receivable — Canonical Source of Truth (SoT)`
10. `RIDER_SHORTAGE_WORKFLOW.md`
11. all other guide docs

Router reminder:

1. When two docs conflict, prefer the owner document listed in section `B. Owner Doc Map`.
2. Diagram and supporting docs must not win over canonical docs.
3. Use diagram docs to understand handoff shape, not to override canonical rule text.

## H. Flow Change Sync Rule (Mandatory)

1. If code changes flow behavior, update the corresponding canonical guide docs in the same objective/PR.
2. Minimum required docs for flow-affecting updates:
   - `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md` when worker schedule, staffing event log, or rider duty-session behavior changes
   - `CANONICAL_ORDER_PRICING_SOT.md` when order-create pricing/freeze behavior changes
   - `CANONICAL_PRODUCTLIST_SHAPE_SOT.md` when product unit/pack/retail shape, stock semantics, or sell-mode rules change
   - `CANONICAL_IDENTITY_ACCESS_FLOW.md` when role/access authority boundaries change
   - relevant `CANONICAL_*.md` flow guide
   - `DIAGRAMS_DELIVERY_CSS_AR.md` when flow nodes/handoffs/decision gates changed
3. Manager/cashier flow changes must not be considered complete until both behavior doc and diagram doc are aligned.
4. Upload/storage behavior changes (driver rules, key naming, validation, metadata lifecycle) must also update `CANONICAL_UPLOAD_STORAGE_SOT.md`.
