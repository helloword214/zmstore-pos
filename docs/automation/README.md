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
2. `npm run ui:test:auth`
3. `npm run ui:test:update`
4. `npm run ui:cycle`
5. `npm run ui:cycle -- --dry-run`

## 4. Required Runtime Inputs

Auth setup defaults (from `login.tsx` dev creds):

1. Manager: `manager1@local` / `manager1123`
2. Rider: `rider1@local` / `rider1123`
3. Cashier PIN: `111111`

You can override via env:

1. `UI_MANAGER_EMAIL`, `UI_MANAGER_PASSWORD`
2. `UI_RIDER_EMAIL`, `UI_RIDER_PASSWORD`
3. `UI_CASHIER_PIN`

Role execution scope:

1. `UI_ROLE_SCOPE=manager` (default)
2. `UI_ROLE_SCOPE=rider`
3. `UI_ROLE_SCOPE=cashier`
4. `UI_ROLE_SCOPE=manager,rider`
5. `UI_ROLE_SCOPE=all`

Optional explicit project override:

1. `UI_PROJECTS=manager-desktop,manager-mobile`

Route options:

1. `UI_RUN_ID`  
   - auto-builds:
     - `/runs/<id>/rider-checkin`
     - `/runs/<id>/remit`
2. `UI_ROUTE_CHECKIN`
3. `UI_ROUTE_REMIT`
4. `UI_ROUTE_RIDER_LIST` (default `/rider/variances`)
5. `UI_ROUTE_RIDER_DETAIL` (optional)
6. `UI_ROUTE_CASHIER_SHIFT` (default `/cashier/shift`)

Auth storage overrides (optional):

1. `UI_MANAGER_STATE_FILE`
2. `UI_RIDER_STATE_FILE`
3. `UI_CASHIER_STATE_FILE`

Optional server inputs:

1. `UI_BASE_URL` (default `http://127.0.0.1:4173`)
2. `UI_SKIP_DEV_SERVER=1` (skip auto-started local dev server)
3. `UI_SKIP_AUTH_SETUP=1` (skip setup projects; use manual session fallback)

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

Run all roles:

```bash
UI_RUN_ID=123 UI_ROLE_SCOPE=all npm run ui:cycle
```

## 6. Operational Cycle

1. run `ui:cycle`
2. check latest file under `docs/automation/runs/`
3. if failed, inspect matching incident file under `docs/automation/incidents/`
4. patch route UI
5. rerun `ui:cycle`

## 7. Recommended Job Split

Use three recurring automations instead of one giant run.

1. Manager monitor
2. Rider monitor
3. Full weekly audit

Why:

1. cleaner failure isolation
2. faster feedback for critical manager flows
3. lower day-to-day runtime cost with weekly full sweep

Default commands per job:

1. Manager: `UI_ROLE_SCOPE=manager npm run ui:cycle`
2. Rider: `UI_ROLE_SCOPE=rider npm run ui:cycle`
3. Full: `UI_ROLE_SCOPE=all npm run ui:cycle`
