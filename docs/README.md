# Documentation Index

This repository uses a tiered documentation model so engineers can quickly find what is binding versus historical.

## 1) Governance (Highest Priority)

1. `docs/Chat Operating Rules/Chat Execution Rules.md`
2. `docs/Governance SOP/Documentation Architecture Standard.md`
3. `docs/Governance SOP/QA Testing Architecture Standard.md`
4. `docs/Governance SOP/AI Governance SOP.md`
5. `docs/guide/Commercial Clearance System V2`

If guidance conflicts, follow the order above.

QA/testing architecture reminder:

1. `docs/Governance SOP/QA Testing Architecture Standard.md` owns QA/testing structure, naming, and artifact boundaries.
2. Scenario checklists, Playwright specs, and setup/cleanup scripts should point back to that owner doc instead of redefining the rules.

## 2) Domain Canonical (Binding for Product Behavior)

Start here for Order Pricing + Delivery + Clearance + Cashier + AR behavior:

1. `docs/guide/README.md`
2. `docs/guide/CANONICAL_UPLOAD_STORAGE_SOT.md`
3. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
4. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
5. `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md`
6. `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`
7. `docs/guide/Commercial Clearance System V2`
8. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
9. `docs/guide/RunReceipt_Architecture.md`

## 3) Automation Operations (Separated)

Use this automation operations stack first when the request mentions UI automation, UI monitoring, or flow smoke execution:

1. `docs/automation/README.md`
2. `docs/automation/runbooks/INTENT_ROUTER.md`
3. `docs/automation/runbooks/UI_CYCLE_RUNBOOK.md`
4. `docs/automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
5. `docs/automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md`

Boundary reminder:

1. `ui:cycle` and `automation:flow:smoke` are separate modes with different input contracts.
2. `UI_RUN_ID` is not a business-flow smoke requirement.

## 4) QA Scenario Docs

Use this stack when the goal is manual QA setup, scenario checklists, or local QA cleanup for a named product flow:

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/qa/README.md`
3. scenario-specific checklist such as `docs/qa/workforce/workforce-payroll-happy-path-checklist.md`

## 5) Archive and Superseded Notes

Use `docs/archive/README.md` for deprecation and migration notes.
Do not use archived documents as implementation authority.

## 6) Authoring Rules (Required)

Every new or updated domain document must include:

- `Status:` (`LOCKED`, `ACTIVE`, `DEPRECATED`, `ARCHIVED`)
- `Owner:` (team/role)
- `Last Reviewed:` (YYYY-MM-DD)
- `Supersedes:` (optional)
- `Superseded By:` (optional)
- If behavior/flow changed in code, update the impacted canonical flow and diagram docs in the same objective/PR.

## 7) Fast Path

For delivery-commercial bugs, read in this order:

1. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md`
4. `docs/guide/Commercial Clearance System V2`
5. `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`
6. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
