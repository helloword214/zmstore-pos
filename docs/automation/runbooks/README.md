# UI Automation Operations Hub

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-22

## 1. Purpose

Provide one entrypoint for all UI automation operations so intent routing is fast and unambiguous.

This hub separates two different execution modes:

1. UI consistency monitoring (`ui:cycle`)
2. Deterministic business-flow smoke (`automation:flow:smoke`)

## 2. Document Map

1. `docs/automation/runbooks/INTENT_ROUTER.md`
2. `docs/automation/runbooks/UI_CYCLE_RUNBOOK.md`
3. `docs/automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
4. `docs/guide/ui/UI_AUTOMATION_GUIDE.md` (visual contract authority)
5. `docs/automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md` (prompt templates)

## 3. Quick Routing

1. If the request is visual consistency monitoring, screenshot drift, or manager/rider/cashier UI checks, use `UI_CYCLE_RUNBOOK.md`.
2. If the request is seeded flow smoke, deterministic setup, or delivery flow smoke automation, use `BUSINESS_FLOW_SMOKE_RUNBOOK.md`.
3. If the request is UI-only patching/styling work, use `docs/guide/ui/UI_AUTOMATION_GUIDE.md` and run validation using `UI_CYCLE_RUNBOOK.md`.

## 4. Hard Boundaries

1. `UI_RUN_ID` is a `ui:cycle` manager route convenience input.
2. `automation:flow:smoke` does not require `UI_RUN_ID`.
3. Business-flow smoke routes come from generated flow context (`FLOW_CONTEXT_FILE`).
4. For `ui:cycle` manager coverage, summary values `Check-in route: not-set` or `Remit route: not-set` mean `BLOCKED`.

## 5. Quick Start

UI consistency monitor (manager):

```bash
UI_RUN_ID=123 UI_ROLE_SCOPE=manager npm run ui:cycle
```

UI consistency monitor (rider):

```bash
UI_ROLE_SCOPE=rider npm run ui:cycle
```

Deterministic business-flow smoke:

```bash
npm run automation:flow:smoke
```

## 6. Evidence Paths

1. `ui:cycle` summaries: `docs/automation/runs/<timestamp>/summary.md`
2. `ui:cycle` incidents: `docs/automation/incidents/<timestamp>.md`
3. Business-flow setup/smoke docs trail: `docs/automation/business-flow/runs/<timestamp>/`
4. Business-flow latest machine-readable artifacts:
   - `test-results/automation/business-flow/context.latest.json`
   - `test-results/automation/business-flow/summary.latest.md`
