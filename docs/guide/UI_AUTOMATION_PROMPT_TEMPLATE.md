# UI Automation Prompt Template

Status: READY TO COPY  
Owner: POS Platform  
Last Reviewed: 2026-02-19

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
1. `docs/guide/UI_AUTOMATION_GUIDE.md`
2. `docs/guide/UI_CONFORMANCE_MATRIX.md`
3. `docs/guide/Clearance CSS Alignment Rules.md`

Route scope:
1. `app/routes/store.dispatch.tsx`
2. `app/routes/runs.$id.dispatch.tsx`
3. `app/routes/runs.$id.summary.tsx`
4. `app/routes/runs.$id.rider-checkin.tsx`
5. `app/routes/store.clearance.tsx`
6. `app/routes/store.clearance_.$caseId.tsx`
7. `app/routes/runs.$id.remit.tsx`
8. `app/routes/cashier.delivery._index.tsx`
9. `app/routes/cashier.delivery.$runId.tsx`
10. `app/routes/delivery-remit.$id.tsx`
11. `app/routes/ar._index.tsx`
12. `app/routes/ar.customers.$id.tsx`
13. `app/routes/cashier.shift.tsx`
14. `app/routes/store.cashier-shifts.tsx`
15. `app/routes/store.cashier-variances.tsx`
16. `app/routes/cashier.charges.tsx`
17. `app/routes/store.cashier-ar.tsx`
18. `app/routes/store.payroll.tsx`
19. `app/routes/store.rider-variances.tsx`
20. `app/routes/rider.variances.tsx`
21. `app/routes/rider.variance.$id.tsx`
22. `app/routes/store.rider-charges.tsx`

UI contract:
1. Root: `min-h-screen bg-[#f7f7fb]`
2. Container: `mx-auto max-w-6xl px-5 py-6` (ledger exception: `max-w-5xl`)
3. Card: `rounded-2xl border border-slate-200 bg-white shadow-sm`
4. Sub-panel: `rounded-xl border border-slate-200 bg-slate-50`
5. Title: `text-base font-semibold tracking-wide`
6. Section title: `text-sm font-medium text-slate-800`
7. Meta: `text-xs text-slate-500` or `text-xs text-slate-600`
8. Monetary/IDs: `font-mono tabular-nums`

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
4. Update `docs/guide/UI_CONFORMANCE_MATRIX.md` status for touched routes.

Output format:
1. Findings (file + line).
2. Patch summary.
3. Validation performed.
4. Remaining UX risks.

After patch, run:
1. `npm run ui:cycle`
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
3. Apply `docs/guide/UI_AUTOMATION_GUIDE.md` contract.
4. Reduce noise (fewer repeated notes/helper text).
5. Update `docs/guide/UI_CONFORMANCE_MATRIX.md` for touched route.

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

Match UI/UX to check-in/remit reference routes and follow `docs/guide/UI_AUTOMATION_GUIDE.md`.
UI-only patch. Minimal diffs. Update matrix status for targeted routes.
```
