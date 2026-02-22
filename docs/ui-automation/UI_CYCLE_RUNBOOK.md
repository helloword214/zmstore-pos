# UI Cycle Runbook

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-22

## 1. Purpose

Run UI consistency monitoring for manager, rider, and cashier surfaces.

Pipeline used:

1. `npm run ui:test`
2. `npm run ui:cycle`
3. Optional snapshot update: `npm run ui:test:update`

## 2. Commands

Manager monitor:

```bash
UI_ROLE_SCOPE=manager npm run ui:cycle
```

Rider monitor:

```bash
UI_ROLE_SCOPE=rider npm run ui:cycle
```

Cashier monitor:

```bash
UI_ROLE_SCOPE=cashier npm run ui:cycle
```

Full monitor:

```bash
UI_ROLE_SCOPE=all npm run ui:cycle
```

Dry run wiring check:

```bash
npm run ui:cycle -- --dry-run
```

## 3. Required Inputs

1. Manager coverage (`UI_ROLE_SCOPE=manager` or `all`) requires:
   - `UI_RUN_ID`, or
   - both `UI_ROUTE_CHECKIN` and `UI_ROUTE_REMIT`
2. Rider defaults:
   - `UI_ROUTE_RIDER_LIST=/rider/variances`
   - `UI_ROUTE_RIDER_DETAIL` is optional
3. Cashier default:
   - `UI_ROUTE_CASHIER_SHIFT=/cashier/shift`
4. Optional server/runtime:
   - `UI_BASE_URL`
   - `UI_SKIP_DEV_SERVER=1`
   - `UI_SKIP_AUTH_SETUP=1`

## 4. Manager Preflight Gate

Before accepting a manager monitoring result:

1. Confirm summary includes non-`not-set` values for both:
   - `Check-in route`
   - `Remit route`
2. If either value is `not-set`, classify result as `BLOCKED` even when process exit code is `0`.

## 5. First-Run Snapshot Bootstrap

Use this once when manager golden-reference snapshots are missing:

```bash
UI_BASE_URL=http://127.0.0.1:4173 \
UI_ROUTE_CHECKIN=/runs/123/rider-checkin \
UI_ROUTE_REMIT=/runs/123/remit \
npm run ui:test:update -- --project=manager-desktop --project=manager-mobile
```

## 6. Artifacts

1. Run summary: `docs/automation/runs/<timestamp>/summary.md`
2. JSON report: `docs/automation/runs/<timestamp>/playwright-report.json`
3. Incident on failure: `docs/automation/incidents/<timestamp>.md`
4. Playwright output: `test-results/ui/artifacts/`
