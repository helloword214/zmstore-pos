# Business-Flow Foundation Runbook

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-22

## 1. Purpose

Describe the deterministic delivery-flow setup foundation that remains after the legacy smoke suite was retired.

Current cycle:

1. setup fixtures
2. optional browser-session bootstrap for downstream delivery QA
3. cleanup when the scenario family is done

## 2. Primary Commands

```bash
npm run automation:flow:setup
npm run automation:flow:cleanup
```

## 3. Important Boundary

1. Do not require `UI_RUN_ID` for this flow.
2. Route targets and seeded IDs are loaded from generated context (`FLOW_CONTEXT_FILE`).
3. The legacy `automation:flow:smoke` command is retired and should not be used.
4. Setup writes latest context to:
   - `test-results/automation/business-flow/context.latest.json`

## 4. Optional Inputs

1. `FLOW_TAG_PREFIX` (default `AUTO-BFLOW`)
2. `FLOW_CLEANUP_SWEEP_PREFIX=<prefix>`
3. Optional route defaults used in context:
   - `UI_ROUTE_RIDER_LIST`
   - `UI_ROUTE_CASHIER_SHIFT`

## 5. Manual Step Commands

Setup only:

```bash
npm run automation:flow:setup
```

Cleanup only:

```bash
npm run automation:flow:cleanup
```

## 6. Failure Stages

1. `setup`: fixture/context generation issue
2. `cleanup`: tagged record cleanup issue
3. downstream QA specs may add their own browser-session or route-level failure stages, but those are owned by the scenario family itself

## 7. Artifacts

Docs trail:

1. `docs/automation/business-flow/runs/<timestamp>/context.json`
2. `docs/automation/business-flow/runs/<timestamp>/summary.md`
3. `docs/automation/business-flow/incidents/<timestamp>.md` (when produced)

Latest machine-readable trail:

1. `test-results/automation/business-flow/context.latest.json`
2. `test-results/automation/business-flow/summary.latest.md`
