# UI Automation Guide — Check-in/Remit Reference Standard

Status: ACTIVE (UI baseline, automation-first)  
Owner: POS Platform  
Last Reviewed: 2026-02-24

## 1. Purpose

Create one consistent, minimalist visual language across active operations routes so users can read state fast, avoid misclicks, and reduce audit mistakes.

This guide is UI-only. It does not change business rules from canonical flow docs.
For canonical UI component set and route priority queue, use `docs/guide/ui/UI_SOT.md`.

## 2. Golden UI/UX Reference

All active routes must visually and behaviorally align with this reference pair:

1. `app/routes/runs.$id.rider-checkin.tsx`
2. `app/routes/runs.$id.remit.tsx`
3. `app/routes/store._index.tsx` (dashboard control sizing and card rhythm)

Reference traits to replicate:

1. Status-first scanning (badges before long explanation).
2. Quiet card-based sections with clear spacing rhythm.
3. Read-only locks and pending states are obvious at a glance.
4. Financial values are emphasized consistently using mono/tabular styling.
5. Action blocks are focused (one dominant action, minimal competing controls).

## 3. Scope

Active route coverage for this baseline:

1. `app/routes/store.dispatch.tsx`
2. `app/routes/store._index.tsx`
3. `app/routes/cashier._index.tsx`
4. `app/routes/rider._index.tsx`
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

## 4. Minimalist Rules (Non-Negotiable)

1. One visual language only.
2. One primary action per section.
3. State first, explanation second.
4. Remove repeated helper text and repeated "Note:" labels.
5. Prefer shared UI primitives over route-local custom class combinations.
6. Match check-in/remit interaction tone before adding new style variants.

## 5. UI Contract (Default Tokens)

### 5.1 Page shell

1. Root: `min-h-screen bg-[#f7f7fb]`
2. Container: `mx-auto max-w-6xl px-5 py-6`
3. Dense ledger exception: `mx-auto max-w-5xl px-5 py-6`
4. Primary card: `rounded-2xl border border-slate-200 bg-white shadow-sm`
5. Sub-panel: `rounded-xl border border-slate-200 bg-slate-50`

### 5.2 Typography

1. Page title: `text-base font-semibold tracking-wide`
2. Section title: `text-sm font-medium text-slate-800`
3. Meta/help text: `text-xs text-slate-500` or `text-xs text-slate-600`
4. Monetary/ID values: `font-mono tabular-nums`

### 5.3 Status pills

1. Base: `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]`
2. `PENDING`: `border-indigo-200 bg-indigo-50 text-indigo-800`
3. `NEEDS_CLEARANCE`: `border-amber-200 bg-amber-50 text-amber-800`
4. `REJECTED`: `border-rose-200 bg-rose-50 text-rose-700`
5. `VOIDED`: `border-slate-200 bg-slate-50 text-slate-600`
6. `DECIDED`/info: `border-slate-200 bg-slate-50 text-slate-600`
7. `FULLY_PAID`: `border-emerald-200 bg-emerald-50 text-emerald-700`

### 5.4 Buttons

1. `primary`: `bg-indigo-600 text-white hover:bg-indigo-700` (one dominant action per section).
2. `secondary`: `bg-slate-700 text-white hover:bg-slate-800` (standard safe action).
3. `tertiary`: `bg-white border border-slate-300 text-slate-700 hover:bg-slate-50` (utility/nav action).
4. `danger`: `bg-rose-600 text-white hover:bg-rose-700` (destructive action only).
5. Default control size: `h-9 px-3 text-sm font-medium rounded-xl`.
6. Size scale: `sm=h-8`, `md=h-9`, `lg=h-10`.
7. Disabled must include: `disabled:opacity-50`.

Button hierarchy rules:

1. Max one `primary` button in a visible section.
2. Use `secondary` for confirm/apply actions that are not the single dominant CTA.
3. Use `tertiary` for back/home/navigation utilities.
4. `danger` must be isolated from primary placement and require clear label semantics.

Minimal hover/focus motion:

1. Use subtle shade shift only (no aggressive animation).
2. Use `transition-colors duration-150` for button transitions.
3. Keep press effect minimal (`active:translate-y-[0.5px]` or equivalent).
4. Use `focus-visible` rings for keyboard clarity.

### 5.5 Feedback banners

1. Error banner: `rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700`
2. Warning banner: `rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800`
3. Success banner: `rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800`

### 5.6 Spacing rhythm

1. Use 2/3/4 scale: `gap-2`, `gap-3`, `p-3`, `p-4`
2. Avoid mixed ad-hoc padding systems inside one page (example: mixing `px-4` and `px-5` without reason)
3. Dashboard top bars should keep one control scale for links/buttons/chips in the same row.

### 5.7 Accent consistency

1. Primary accent ramp is `indigo` only for active operational UI.
2. Primary action/link text: `text-indigo-700` with hover `text-indigo-800`.
3. Primary fill action: `bg-indigo-600` with hover `bg-indigo-700`.
4. Subtle accent surfaces: `bg-indigo-50` / `bg-indigo-100` only.
5. Avoid mixed blue families (`sky`, `blue`) in the same operational surface unless explicitly documented.

## 6. UX Behavior Contract

### 6.1 Visual hierarchy and scanning

1. Each page should have one top summary band, then section cards.
2. Each section header must answer: what this block is, what count/status it has.
3. Keep action groups right-aligned and summary text left-aligned where possible.

### 6.2 Interaction patterns

1. Read-only and locked states must reduce interactivity (`disabled`, muted styling, lock-safe hint).
2. Collapsible details are preferred for long receipt rows or dense item lists.
3. Do not expose duplicate actions for the same outcome in one viewport block.

### 6.3 Forms and tables

1. Form labels are short and operational.
2. Required fields are marked once, not repeated in every helper line.
3. Financial/qty columns use right alignment and tabular numbers.
4. Empty states must say what is missing and what user can do next.
5. Input and select focus states must use the same indigo focus ramp (`focus:border-indigo-300` + `focus:ring-indigo-200`).

### 6.4 Feedback timing and placement

1. Place action result banner near the top of actionable area.
2. Inline row feedback is allowed only when tied to a specific row action.
3. Avoid multiple warning banners stacked for the same issue.

### 6.5 Responsive behavior

1. Desktop first for operational tables.
2. Mobile fallback must keep key status/action visible without horizontal confusion.
3. If table density is high, prioritize summary + expandable detail blocks on mobile.

### 6.6 Accessibility baseline

1. All actionable controls must have visible focus styles.
2. Color must not be the only status signal; include text label.
3. Tap targets should remain comfortably clickable (`h-9` minimum pattern).

### 6.7 Microcopy tone

1. Use concise, action-oriented wording.
2. Avoid narrative/paragraph instructions in-row.
3. Prefer one-time section guidance over repeated row notes.

## 7. Noise Budget

To keep screens quiet and operational:

1. Max one helper/meta line per section header.
2. Max two metadata lines per table cell.
3. Do not repeat the same instructional sentence per row.
4. If policy text is long, place it once near the page title, not inside every card.
5. Prefer concise labels over sentence-length button text.

### 7.1 Manager header rule

For `app/routes/store._index.tsx`:

1. Keep header low-noise: identity + notification bell + logout only.
2. Do not duplicate dashboard route cards as header chips.
3. Reminder entry point should use bell/panel pattern (event-style list), not a second dashboard block.

### 7.2 Non-dashboard header rule

For operational routes outside dashboards (example: `store.dispatch`, `store.cashier-variances`):

1. Use a single header pattern via `SoTNonDashboardHeader`.
2. Header is utility-only: left `← Dashboard` link and title/subtitle.
3. Do not place primary action buttons in non-dashboard headers.
4. Put page primary CTA in the first body action bar (above filters/tables).
5. Keep one navigation utility action only in the header.

### 7.3 Footer rule

1. No global footer by default for operational routes.
2. Add footer only for mandatory legal/version/support requirements.

### 7.4 SoT interactive states

1. SoT links/buttons/summary controls should use `transition-colors duration-150`.
2. Use `focus-visible` ring pattern: `focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`.
3. Keep active press subtle only: `active:translate-y-[0.5px]` (or none).
4. Avoid large hover motion or scale animations in ops routes.

### 7.5 SoT card interaction rule

1. Use `SoTCard` for card shells in dashboard and operational summary panels.
2. Only interactive cards (`Link` destination cards) may use hover + pointer.
3. Static informational cards must have no pointer and no hover-lift behavior.
4. Cards with form controls (`input/select/textarea`) must use `interaction="form"` (no card-level hover/pointer).
5. Card interaction mode must be explicit: `interaction="link" | "form" | "static"`.

## 8. Reuse Rules

1. Use shared status pills (`StatusPill`) wherever possible.
2. Use shared button variants (`Button`) for action consistency.
3. Avoid route-local custom pill shades when a standard tone exists.
4. New route UI must conform to this guide before feature completion is tagged done.
5. Reuse the check-in/remit section framing pattern before creating new wrappers.
6. Use the shared SoT component set from `UI_SOT.md` before adding route-local variants.

### 8.1 SoT primitives (required)

1. `SoTFormField`: label/hint/error wrapper for input/select/textarea groups.
2. `SoTDataRow`: compact label-value row for card metrics and next-step rows.
3. `SoTStatusBadge`: canonical status badge tone mapping.
4. `SoTEmptyState`: standard no-data block with optional hint/action.
5. `SoTActionBar`: top-of-body action alignment (utility left, actions right).

Usage rule:

1. If the same UI pattern appears twice in focused routes, use the corresponding SoT primitive instead of route-local markup.

## 9. Automation Gates (Target)

### 9.0 Current Enforcement Boundary (Read This First)

Current automated UI enforcement is limited to these active specs:

1. `tests/ui/manager.golden-reference.spec.ts`
2. `tests/ui/rider.golden-reference.spec.ts`
3. `tests/ui/cashier.golden-reference.spec.ts`

Interpretation rule:

1. Section 9.2 list is the target critical coverage set.
2. If a route in 9.2 is not yet represented by an active spec, treat it as planned coverage, not enforced coverage.
3. `not-set` route gate applies to `ui:cycle` manager monitoring only.
4. Business-flow smoke (`automation:flow:smoke`) is context-driven and should not require `UI_RUN_ID`.
5. Execution intent routing and runtime inputs are governed by `docs/automation/runbooks/INTENT_ROUTER.md`.

### 9.1 Operating Model: Monitor vs Repair (Mandatory)

UI automation uses two distinct flows. Do not combine them into one run intent.

1. Monitor flow (`ui:cycle`):
2. Goal: detect and classify UI drift, then publish run evidence.
3. Allowed actions: environment preflight, DB recovery attempt, visual/spec checks, summary + incident outputs.
4. Not allowed: route/component code edits, baseline updates, or git commits.

1. Repair flow (manual or dedicated repair automation):
2. Goal: fix a known incident from monitor evidence.
3. Allowed actions: targeted UI patch, targeted test rerun, PR creation, optional baseline update when design approval exists.
4. Required input: latest incident reference and explicit source-of-truth decision (patch code vs refresh baseline).

### 9.2 Static conformance check

Add a CI/static check that validates:

1. Route shell tokens are present.
2. Deprecated shell pattern (`bg-slate-50` + `px-4` legacy admin layout) is flagged for migration routes.
3. Status classes map to approved tones only.
4. Repeated note markers above threshold are reported as warnings.
5. Check-in/remit reference traits are met for changed routes.

### 9.3 Visual smoke checks

Baseline screenshots should run at:

1. Desktop: `1366x900`
2. Mobile: `390x844`

Critical smoke pages:

1. `store._index.tsx`
2. `cashier._index.tsx`
3. `rider._index.tsx`
4. `store.clearance.tsx`
5. `store.clearance_.$caseId.tsx`
6. `runs.$id.rider-checkin.tsx`
7. `runs.$id.remit.tsx`
8. `cashier.delivery.$runId.tsx`
9. `delivery-remit.$id.tsx`
10. `ar._index.tsx`
11. `ar.customers.$id.tsx`
12. `store.cashier-variances.tsx`
13. `store.rider-variances.tsx`

### 9.4 PR merge gate

Do not mark UI PR as ready to merge when:

1. Static conformance check fails.
2. Critical screenshot drift is unreviewed.
3. `docs/guide/ui/UI_CONFORMANCE_MATRIX.md` is not updated for touched active routes.
4. `ui:cycle` manager monitoring evidence has `Check-in route: not-set` or `Remit route: not-set`.

### 9.5 Incident Severity Policy

1. `INFRA`: preflight/setup/runtime blocker (DB/env/runner) that prevents meaningful UI evaluation.
2. `PRIMARY`: mismatch on Rider Dashboard or Cashier Dashboard.
3. `SECONDARY`: mismatch outside primary routes (example: manager mobile dashboard, cashier shift console).

Expected monitor handling:

1. `INFRA`: retry/autorecover path first, then fail run with actionable incident note.
2. `PRIMARY`: fail fast and escalate in incident summary.
3. `SECONDARY`: record incident and continue scheduled cadence.

## 10. Rollout Order

1. Phase 1 (highest drift): `runs.$id.dispatch.tsx`, `store.cashier-variances.tsx`, `cashier.charges.tsx`, `store.cashier-ar.tsx`, rider-variance admin/rider pages.
2. Phase 2 (partial drift): dispatch/summary/index/AR/shift pages.
3. Phase 3 (hardening): consolidate wrappers and shared page shell primitives.

## 11. Definition of Done (Per Route)

1. Uses standard shell tokens.
2. Uses approved typography scale.
3. Uses approved status pill tones.
4. Keeps helper text within noise budget.
5. Passes desktop and mobile visual smoke check.
6. No business rule logic changes were introduced by style-only work.
7. Interaction behavior is aligned with check-in/remit reference style.

## 12. Non-Goals

1. This guide does not alter commercial decision logic.
2. This guide does not redefine AR authority rules.
3. This guide does not replace canonical flow documentation.

## 13. Automation Commands (Reference)

Execution source of truth:

1. `docs/automation/runbooks/INTENT_ROUTER.md`
2. `docs/automation/runbooks/UI_CYCLE_RUNBOOK.md`
3. `docs/automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
4. `docs/automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md`

1. `npm run ui:test`
2. `npm run ui:test:auth`
3. `npm run ui:test:update`
4. `npm run ui:cycle`
5. `npm run ui:cycle -- --dry-run`

Business-flow engine (separate from UI consistency):

1. `npm run automation:flow:setup`
2. `npm run automation:flow:smoke`
3. `npm run automation:flow:cleanup`
4. Reference: `docs/automation/architecture/BUSINESS_FLOW_ENGINE.md`

Run evidence output:

1. `docs/automation/runs/<timestamp>/summary.md`
2. `docs/automation/runs/<timestamp>/playwright-report.json`
3. `docs/automation/incidents/<timestamp>.md` (created on failure)
