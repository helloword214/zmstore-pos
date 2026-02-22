# UI Automation Prompt Template

Status: READY TO COPY  
Owner: POS Platform  
Last Reviewed: 2026-02-22

Scope note:

1. This template is for UI consistency automation.
2. For deterministic business-flow smoke automation, use `docs/automation/architecture/BUSINESS_FLOW_ENGINE.md`.
3. Resolve execution mode first using `docs/automation/runbooks/INTENT_ROUTER.md`.

## 1. Full Prompt (Recommended)

```md
You are the UI Consistency Automation Agent for `zmstore-pos-2`.

Objective:
Standardize UI/UX with minimalist, low-noise behavior across active routes using:
1. `app/routes/runs.$id.rider-checkin.tsx` as the interaction reference.
2. `app/routes/runs.$id.remit.tsx` as the layout/recap reference.

Hard constraints:
1. UI-only changes. Do not change business rules or data logic.
2. No silent renames or broad refactors.
3. Minimal targeted diffs only.
4. Reuse shared primitives first (`StatusPill`, shared button/card patterns).

Primary docs to follow:
1. `docs/guide/ui/UI_AUTOMATION_GUIDE.md`
2. `docs/guide/ui/UI_CONFORMANCE_MATRIX.md`
3. `docs/guide/ui/Clearance CSS Alignment Rules.md`
4. `docs/automation/runbooks/UI_CYCLE_RUNBOOK.md` (runtime gate and evidence rules)

Route scope:
1. `app/routes/store._index.tsx`
2. `app/routes/cashier._index.tsx`
3. `app/routes/rider._index.tsx`
4. `app/routes/store.dispatch.tsx`
5. `app/routes/runs.$id.dispatch.tsx`
6. `app/routes/runs.$id.summary.tsx`
7. `app/routes/runs.$id.rider-checkin.tsx`
8. `app/routes/store.clearance.tsx`
9. `app/routes/store.clearance_.$caseId.tsx`
10. `app/routes/runs.$id.remit.tsx`
11. `app/routes/cashier.delivery._index.tsx`
12. `app/routes/cashier.delivery.$runId.tsx`
13. `app/routes/delivery-remit.$id.tsx`
14. `app/routes/ar._index.tsx`
15. `app/routes/ar.customers.$id.tsx`
16. `app/routes/cashier.shift.tsx`
17. `app/routes/store.cashier-shifts.tsx`
18. `app/routes/store.cashier-variances.tsx`
19. `app/routes/cashier.charges.tsx`
20. `app/routes/store.cashier-ar.tsx`
21. `app/routes/store.payroll.tsx`
22. `app/routes/store.rider-variances.tsx`
23. `app/routes/rider.variances.tsx`
24. `app/routes/rider.variance.$id.tsx`
25. `app/routes/store.rider-charges.tsx`

UI contract:
1. Root: `min-h-screen bg-[#f7f7fb]`
2. Container: `mx-auto max-w-6xl px-5 py-6` (ledger exception: `max-w-5xl`)
3. Card: `rounded-2xl border border-slate-200 bg-white shadow-sm`
4. Sub-panel: `rounded-xl border border-slate-200 bg-slate-50`
5. Title: `text-base font-semibold tracking-wide`
6. Section title: `text-sm font-medium text-slate-800`
7. Meta: `text-xs text-slate-500` or `text-xs text-slate-600`
8. Monetary/IDs: `font-mono tabular-nums`
9. Default interactive size: `rounded-xl px-3 py-2 text-sm font-medium`

Status pills:
1. Base: `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]`
2. PENDING = indigo
3. NEEDS_CLEARANCE = amber
4. REJECTED = rose
5. VOIDED/DECIDED = slate
6. FULLY_PAID = emerald

Buttons:
1. Primary = indigo solid
2. Secondary = white/slate border
3. Destructive = rose solid
4. Disabled must include `disabled:opacity-50`

Noise budget:
1. Max one helper line per section header.
2. Max two metadata lines per table cell.
3. Remove repeated row-level notes.
4. Keep copy short and operational.

Execution sequence:
1. Audit target routes and list concrete drift with file references.
2. Patch only UI/UX alignment issues.
3. Keep behavior unchanged.
4. Update `docs/guide/ui/UI_CONFORMANCE_MATRIX.md` status for touched routes.

Output format:
1. Findings (file + line).
2. Patch summary.
3. Validation performed.
4. Remaining UX risks.

After patch, run:
1. `UI_ROLE_SCOPE=manager npm run ui:cycle`
2. Attach latest `docs/automation/runs/<timestamp>/summary.md` in report.
```

## 2. Quick Prompt (Daily Use)

```md
Align this route to the UI/UX style of:
1. `app/routes/runs.$id.rider-checkin.tsx`
2. `app/routes/runs.$id.remit.tsx`

Rules:
1. UI-only changes, no logic changes.
2. Minimal diff, no broad refactor.
3. Apply `docs/guide/ui/UI_AUTOMATION_GUIDE.md` contract.
4. Reduce noise (fewer repeated notes/helper text).
5. Update `docs/guide/ui/UI_CONFORMANCE_MATRIX.md` for touched route.

Return:
1. Findings
2. Patch summary
3. Validation

Then run `npm run ui:cycle` and attach latest run summary.
```

## 3. Route-Scoped Prompt Variant

Use this when you want to target specific routes only:

```md
Target routes only:
1. <route-1>
2. <route-2>

Match UI/UX to check-in/remit reference routes and follow `docs/guide/ui/UI_AUTOMATION_GUIDE.md`.
UI-only patch. Minimal diffs. Update matrix status for targeted routes.
```

## 4. One-Job ALL (Starter)

Use this if you want a single scheduled automation that checks manager, rider, and cashier in one run.

```md
Run `UI_ROLE_SCOPE=all npm run ui:cycle`.

After run, locate the latest:
1. `docs/automation/runs/<timestamp>/summary.md`
2. `docs/automation/runs/<timestamp>/playwright-report.json`

Report using this exact structure:
1. Manager: PASS/FAIL + expected/unexpected/skipped
2. Rider: PASS/FAIL + expected/unexpected/skipped
3. Cashier: PASS/FAIL + expected/unexpected/skipped
4. Overall: PASS/FAIL
5. Latest summary path
6. If failed: top failing tests and incident path under `docs/automation/incidents/<timestamp>.md`
```

## 5. Three-Job Operational Set (Recommended)

Use these as three separate automation jobs.

Why this works better than one giant job:

1. failures are easier to isolate by role/scope
2. critical manager flow can run more frequently
3. weekly full sweep catches cross-role regressions

Analogy:

1. Job A = front gate guard (critical path check, frequent)
2. Job B = loading bay guard (rider lane check, frequent)
3. Job C = chief inspector (full building audit, weekly)

### 5.1 Job A: Manager Monitor (Daily)

```md
Run UI monitoring for manager-critical routes.

Task:
1. Execute `UI_ROLE_SCOPE=manager npm run ui:cycle`.
2. Allow built-in route auto-wiring:
   - manager dashboard: `UI_ROUTE_MANAGER_DASHBOARD` (default `/store`)
   - explicit `UI_ROUTE_CHECKIN` / `UI_ROUTE_REMIT`
   - `UI_RUN_ID`
   - `test-results/automation/business-flow/context.latest.json`
   - auto `npm run automation:flow:setup` (non-dry-run)
3. Inspect latest `docs/automation/runs/<timestamp>/summary.md`.
4. If summary has `Failure stage: preflight`, report `BLOCKED` and stop.
5. Report pass/fail and include latest `docs/automation/runs/<timestamp>/summary.md`.
6. If failed, include top failures and incident path under `docs/automation/incidents/<timestamp>.md`.
```

### 5.2 Job B: Rider Monitor (Daily)

```md
Run UI monitoring for rider routes.

Task:
1. Execute `UI_ROLE_SCOPE=rider npm run ui:cycle`.
2. Use `UI_ROUTE_RIDER_LIST` (default `/rider/variances`).
3. Use `UI_ROUTE_RIDER_DETAIL` when available; if missing, run list-only and note it.
4. Report pass/fail and include latest `docs/automation/runs/<timestamp>/summary.md`.
```

### 5.3 Job C: Full Weekly Audit

```md
Run full UI monitoring across manager, rider, and cashier scopes.

Task:
1. Execute `UI_ROLE_SCOPE=all npm run ui:cycle`.
2. Let manager routes use built-in auto-wiring (env/UI_RUN_ID/context.latest/auto-setup).
3. Report consolidated status:
   - manager
   - rider
   - cashier
4. Include latest `docs/automation/runs/<timestamp>/summary.md`.
5. If failed, include top failure samples and point to incident file under `docs/automation/incidents/`.
```

### 5.4 Suggested Cadence

1. Job A (Manager): weekdays, morning
2. Job B (Rider): daily, late afternoon
3. Job C (Full): weekly (Friday evening)

### 5.5 First-Run Baseline Bootstrap (Manager, Optional)

Use this once when manager golden-reference snapshots are missing:

```bash
UI_BASE_URL=http://127.0.0.1:4173 \
UI_ROUTE_MANAGER_DASHBOARD=/store \
UI_ROUTE_CHECKIN=/runs/123/rider-checkin \
UI_ROUTE_REMIT=/runs/123/remit \
npm run ui:test:update -- --project=manager-desktop --project=manager-mobile
```

## 6. Business-Flow Smoke Prompt (Separate Job)

Use this when you want setup-driven smoke checks for delivery flow records.

```md
Run business-flow smoke automation using the deterministic engine.

Runbook authority:
1. `docs/automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`

Task:
1. Execute `npm run automation:flow:smoke`.
2. Do not require `UI_RUN_ID`; use generated context from setup (`FLOW_CONTEXT_FILE`).
3. Report whether setup, auth, smoke, and cleanup completed.
4. Include latest context and summary artifacts:
   - `test-results/automation/business-flow/context.latest.json`
   - `test-results/automation/business-flow/summary.latest.md`
5. If failed, classify the failed stage (`setup`, `auth`, or `smoke`) and include top failing route/test.
```
