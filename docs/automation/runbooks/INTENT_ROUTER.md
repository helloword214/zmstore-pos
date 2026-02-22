# UI Automation Intent Router

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-22

## 1. Purpose

Route UI automation requests to the correct execution mode with minimal ambiguity.

## 2. Router Rules

1. Choose `UI_CYCLE_MONITOR` when request is about UI consistency checks, screenshot drift, manager/rider/cashier monitoring, or `ui:cycle`.
2. Choose `BUSINESS_FLOW_SMOKE` when request is about delivery flow smoke, deterministic setup, run provisioning, or `automation:flow:smoke`.
3. Choose `UI_PATCH_VALIDATION` when request is UI-only patching and needs post-patch monitoring.
4. If no clear signal exists, ask one clarifying question: "Do you want `ui:cycle` monitoring or business-flow smoke?"

## 3. Mode Contracts

### 3.1 `UI_CYCLE_MONITOR`

1. Command source: `docs/automation/runbooks/UI_CYCLE_RUNBOOK.md`
2. Primary command: `npm run ui:cycle`
3. Manager coverage requirement:
   - set `UI_RUN_ID`, or
   - set both `UI_ROUTE_CHECKIN` and `UI_ROUTE_REMIT`
4. Blocked condition:
   - run summary includes `Check-in route: not-set` or `Remit route: not-set`
5. Primary evidence:
   - `docs/automation/runs/<timestamp>/summary.md`

### 3.2 `BUSINESS_FLOW_SMOKE`

1. Command source: `docs/automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
2. Primary command: `npm run automation:flow:smoke`
3. Input rule:
   - do not require `UI_RUN_ID`
4. Route source:
   - generated flow context (`FLOW_CONTEXT_FILE`)
5. Primary evidence:
   - `test-results/automation/business-flow/context.latest.json`
   - `test-results/automation/business-flow/summary.latest.md`

### 3.3 `UI_PATCH_VALIDATION`

1. Patch authority: `docs/guide/UI_AUTOMATION_GUIDE.md`
2. Prompt source: `docs/automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md`
3. Validation execution:
   - use `UI_CYCLE_MONITOR` via `docs/automation/runbooks/UI_CYCLE_RUNBOOK.md`

## 4. Anti-Confusion Guards

1. `UI_RUN_ID` is not a global automation requirement.
2. `ui:cycle` and `automation:flow:smoke` are different pipelines with different contracts.
3. Business-flow smoke creates its own deterministic run IDs during setup.
