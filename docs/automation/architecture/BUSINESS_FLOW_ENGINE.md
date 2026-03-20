# Business Flow Engine

Status: ACTIVE (foundation)  
Owner: POS Platform  
Last Reviewed: 2026-02-20

## 1. Purpose

Provide a deterministic automation engine for delivery business flows that can be reused by:

1. Domain-scoped delivery QA scenario families
2. Browser-session bootstrap helpers
3. Future full end-to-end workflow assertions

This separates deterministic data lifecycle concerns from downstream route assertions.

## 2. Design Principle

Use one control-tower entrypoint and modular internals.

1. Control tower: `scripts/automation/business-flow/index.mjs`
2. Deterministic setup: `scripts/automation/business-flow/steps/setup.mjs`
3. Deterministic cleanup: `scripts/automation/business-flow/steps/cleanup.mjs`
4. Shared contracts/paths: `scripts/automation/business-flow/contracts.mjs`

## 3. Engine Cycle

```mermaid
flowchart TD
  A["Setup fixtures"] --> B["Write context.json"]
  B --> C["Optional browser-session bootstrap"]
  C --> D["Domain scenario-family QA uses context"]
  D --> E["Collect downstream reports"]
  E --> F["Cleanup by context IDs"]
```

## 4. Setup Contract

Current setup creates deterministic records with trace tags:

1. one `CHECKED_IN` delivery run
2. one `CLOSED` delivery run
3. one delivery order linked to each run
4. route context output for manager/rider/cashier delivery QA usage

Artifacts:

1. `docs/automation/business-flow/runs/<timestamp>/context.json`
2. `docs/automation/business-flow/runs/<timestamp>/summary.md`
3. `test-results/automation/business-flow/context.latest.json`
4. `test-results/automation/business-flow/summary.latest.md`

## 5. Commands

1. `npm run automation:flow:setup`
2. `npm run automation:flow:cleanup`

Optional env:

1. `FLOW_TAG_PREFIX` (default `AUTO-BFLOW`)
2. `FLOW_CLEANUP_SWEEP_PREFIX=<prefix>` (bulk cleanup by code prefix)

## 6. Current Reuse Scope

Current delivery scenario families that reuse this foundation include:

1. `tests/ui/delivery/delivery-run-handoff-and-remit-access-happy-path.spec.ts`
2. `tests/ui/delivery/delivery-manager-remit-posting-happy-path.spec.ts`
3. `tests/ui/delivery/delivery-cashier-order-remit-posting-happy-path.spec.ts`
4. `tests/ui/delivery/delivery-cashier-order-remit-shortage-path.spec.ts`
5. `tests/ui/delivery/delivery-manager-shortage-review-charge-path.spec.ts`
6. `tests/ui/delivery/delivery-rider-acceptance-path.spec.ts`
7. `tests/ui/delivery/delivery-final-settlement-gating.spec.ts`

## 7. Scaling Rules

When extending this engine:

1. add new flow steps under `scripts/automation/business-flow/steps/`
2. keep setup output schema backward-compatible
3. avoid direct hardcoded IDs in tests
4. prefer context-driven routes and record IDs
5. keep cleanup idempotent and scoped by explicit IDs/tags

## 8. Current Boundary

This foundation does not yet automate full interaction actions (create order via UI, assign rider via UI, dispatch click-flow, remit posting click-flow).  
It provisions deterministic records directly for reusable delivery setup and cleanup. The older route-level smoke layer was retired after the dedicated delivery scenario families above became canonical.
