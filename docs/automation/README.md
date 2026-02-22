# Automation Flow Guide

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-22

## 1. Purpose

This folder stores automation execution trails and generated evidence artifacts.

Execution instructions are maintained in `docs/ui-automation/` to keep operational intent routing separate from artifact storage docs.

Automation evidence is grouped into:

1. UI consistency checks
2. Business flow smoke checks

## 2. Folder Structure

1. `docs/automation/runs/`
2. `docs/automation/incidents/`
3. `docs/automation/business-flow/runs/`
4. `docs/automation/business-flow/incidents/`

`runs/` and `incidents/` are for UI consistency cycle output.  
`business-flow/runs/` and `business-flow/incidents/` are for business-flow engine output.

## 3. Commands

UI consistency mode:

1. `npm run ui:test`
2. `npm run ui:test:auth`
3. `npm run ui:test:update`
4. `npm run ui:cycle`
5. `npm run ui:cycle -- --dry-run`

Business-flow smoke mode:

1. `npm run automation:flow:setup`
2. `npm run automation:flow:smoke`
3. `npm run automation:flow:cleanup`

## 4. Operational Source of Truth

Use these docs for all execution instructions and input requirements:

1. `docs/ui-automation/README.md`
2. `docs/ui-automation/INTENT_ROUTER.md`
3. `docs/ui-automation/UI_CYCLE_RUNBOOK.md`
4. `docs/ui-automation/BUSINESS_FLOW_SMOKE_RUNBOOK.md`

## 5. Artifact Interpretation

UI consistency (`ui:cycle`) artifacts:

1. `docs/automation/runs/<timestamp>/summary.md`
2. `docs/automation/runs/<timestamp>/playwright-report.json`
3. `docs/automation/incidents/<timestamp>.md`

Business-flow smoke artifacts:

1. `docs/automation/business-flow/runs/<timestamp>/context.json`
2. `docs/automation/business-flow/runs/<timestamp>/summary.md`
3. `test-results/automation/business-flow/context.latest.json`
4. `test-results/automation/business-flow/summary.latest.md`

## 6. Minimal Evidence Cycle

1. Resolve intent first using `docs/ui-automation/INTENT_ROUTER.md`.
2. Execute the matching runbook command.
3. Review latest summary/context artifacts.
4. Classify as `PASS`, `FAIL`, or `BLOCKED`.
5. Patch and rerun when needed.
