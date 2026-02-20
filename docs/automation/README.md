# Automation Flow Guide

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-19

## 1. Purpose

This folder stores the execution trail of UI automation runs and incidents.

Flow intent:

1. run Playwright checks on golden reference routes
2. capture evidence
3. classify failure
4. patch and verify
5. keep learnings traceable

## 2. Folder Structure

1. `docs/automation/runs/`
2. `docs/automation/incidents/`

`runs/` contains per-run summaries and JSON report outputs.  
`incidents/` contains failure records generated when a run fails.

## 3. Commands

1. `npm run ui:test`
2. `npm run ui:test:update`
3. `npm run ui:cycle`
4. `npm run ui:cycle -- --dry-run`

## 4. Required Runtime Inputs

Set at least one of the following route options:

1. `UI_RUN_ID`  
   - auto-builds:
     - `/runs/<id>/rider-checkin`
     - `/runs/<id>/remit`
2. `UI_ROUTE_CHECKIN` and `UI_ROUTE_REMIT`

Optional session inputs:

1. `UI_AUTH_COOKIE_NAME`
2. `UI_AUTH_COOKIE_VALUE`
3. `UI_AUTH_LOCAL_STORAGE` (JSON object string)

Optional server inputs:

1. `UI_BASE_URL` (default `http://127.0.0.1:4173`)
2. `UI_SKIP_DEV_SERVER=1` (skip auto-started local dev server)

## 5. Minimal Example

```bash
UI_RUN_ID=123 npm run ui:cycle
```

or

```bash
UI_BASE_URL=http://127.0.0.1:4173 \
UI_ROUTE_CHECKIN=/runs/123/rider-checkin \
UI_ROUTE_REMIT=/runs/123/remit \
npm run ui:cycle
```

## 6. Operational Cycle

1. run `ui:cycle`
2. check latest file under `docs/automation/runs/`
3. if failed, inspect matching incident file under `docs/automation/incidents/`
4. patch route UI
5. rerun `ui:cycle`

