# Business-Flow Smoke Runbook

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-22

## 1. Purpose

Run deterministic delivery-flow smoke checks with setup-driven context.

Default cycle:

1. setup fixtures
2. auth setup
3. smoke projects
4. cleanup (unless `FLOW_KEEP_DATA=1`)

## 2. Primary Command

```bash
npm run automation:flow:smoke
```

## 3. Important Boundary

1. Do not require `UI_RUN_ID` for this flow.
2. Route targets are loaded from generated context (`FLOW_CONTEXT_FILE`).
3. Setup writes latest context to:
   - `test-results/automation/business-flow/context.latest.json`

## 4. Optional Inputs

1. `FLOW_TAG_PREFIX` (default `AUTO-BFLOW`)
2. `FLOW_KEEP_DATA=1` (keep setup records after smoke)
3. `FLOW_PROJECTS=manager-flow-desktop,rider-flow-desktop,cashier-flow-desktop`
4. `FLOW_CLEANUP_SWEEP_PREFIX=<prefix>`
5. Optional route defaults used in context:
   - `UI_ROUTE_RIDER_LIST`
   - `UI_ROUTE_CASHIER_SHIFT`

## 5. Manual Step Commands

Setup only:

```bash
npm run automation:flow:setup
```

Smoke only:

```bash
npm run automation:flow:smoke
```

Cleanup only:

```bash
npm run automation:flow:cleanup
```

## 6. Failure Stages

1. `setup`: fixture/context generation issue
2. `auth`: login/bootstrap auth projects failed
3. `smoke`: route-level flow checks failed

## 7. Artifacts

Docs trail:

1. `docs/automation/business-flow/runs/<timestamp>/context.json`
2. `docs/automation/business-flow/runs/<timestamp>/summary.md`
3. `docs/automation/business-flow/incidents/<timestamp>.md` (when produced)

Latest machine-readable trail:

1. `test-results/automation/business-flow/context.latest.json`
2. `test-results/automation/business-flow/summary.latest.md`
