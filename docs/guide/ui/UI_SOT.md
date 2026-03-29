# UI SoT (Source of Truth)

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-29

## 1. Purpose

Define one canonical UI system for route refactors and automation-driven UI upgrades.
This SoT is for UI/UX structure, spacing, typography, and reusable components.
It must not change business logic.

## 2. Canonical Design References

Use these routes as visual interaction anchors:

1. `app/routes/runs.$id.rider-checkin.tsx`
2. `app/routes/runs.$id.remit.tsx`
3. `app/routes/store._index.tsx`
4. `app/routes/_index.tsx`
5. `app/routes/cashier._index.tsx`
6. `app/routes/rider._index.tsx`

## 3. SoT Component Set

SoT reusable components (catalog + minimum baseline):

1. `app/components/ui/SoTButton.tsx`
2. `app/components/ui/SoTInput.tsx`
3. `app/components/ui/SoTCard.tsx`
4. `app/components/ui/SoTSectionHeader.tsx`
5. `app/components/ui/SoTStatusPill.tsx`
6. `app/components/ui/SoTDropdown.tsx`
7. `app/components/ui/SoTTable.tsx`
8. `app/components/ui/SoTAlert.tsx`
9. `app/components/ui/SoTRoleShellHeader.tsx`
10. `app/components/ui/SoTPageHeader.tsx`
11. `app/components/ui/SoTNonDashboardHeader.tsx`
12. `app/components/ui/SoTActionBar.tsx`
13. `app/components/ui/SoTDataRow.tsx`
14. `app/components/ui/SoTEmptyState.tsx`
15. `app/components/ui/SoTFormField.tsx`
16. `app/components/ui/SoTNotificationBell.tsx`
17. `app/components/ui/SoTStatusBadge.tsx`
18. `app/components/ui/SoTBrandFooter.tsx`
19. `app/components/ui/SoTLoadingState.tsx`
20. `app/components/ui/SoTDashboardPrimitives.tsx`

Rule:

1. If repeated UI pattern appears in 2+ routes, extract shared SoT component first.
2. Prefer shared component usage over route-local class duplication.

Operational usage baseline:

1. List/queue pages should prefer `SoTTable` for table shell, header cells, row cells, and empty-row fallback.
2. Inline notices/banners should prefer `SoTAlert` over route-local alert class blocks.
3. Role-based route groups should prefer `SoTRoleShellHeader` for identity and logout action, with low-noise top navigation.
4. Operational non-dashboard routes should prefer `SoTNonDashboardHeader` for back-link + title/subtitle structure.
5. Individual route titles/actions should prefer `SoTPageHeader` and avoid custom per-route header shells.
6. Manager dashboard should be action-inbox-first: top cards must be pending decisions (clearance, remit/close review, variances) before monitor-only stats.
7. Global endorsement/footer line should use `SoTBrandFooter` and remain subtle/non-blocking.
8. App-shell route transitions should prefer `SoTLoadingState` with the `overlay` variant.
9. Form, card, or table saving states should prefer `SoTLoadingState` with the `panel` or `inline` variant instead of route-local spinners or opacity-only pending cues.
10. Dashboard routes should prefer `SoTDashboardPrimitives` for `Priority Strip`, `Workbench`, `Signals`, `Quick Actions`, and `Reference` structure before adding route-local dashboard layout wrappers.

Component gap rule:

1. If required UI pattern has no SoT component yet, create SoT component first.
2. Add usage sample in at least one real route in the same objective.
3. Treat first implementation as review sample; operator may request revision before wider rollout.

## 3.1 Typography Scale (Mandatory)

1. Page title: `text-xl font-semibold tracking-tight text-slate-900`
2. Section title: `text-xs font-semibold uppercase tracking-wide text-slate-500`
3. Card title: `text-xs font-semibold uppercase tracking-wide text-slate-600`
4. Primary value text: `text-sm font-semibold text-slate-900`
5. Supporting meta text: `text-xs text-slate-500`
6. Status/helper emphasis text: `text-xs font-medium`

## 3.2 Spacing Scale (Mandatory)

1. Page container rhythm: `space-y-5`
2. Section block gap: `mb-3` header + `gap-3` grid
3. Card padding: `p-4` default, `p-3` compact
4. Control height: `h-9` for inputs/selects/buttons in dense operational rows
5. Input/select/button corner radius: `rounded-xl`
6. Primary card corner radius: `rounded-2xl`

## 3.3 Loading State Contract (Mandatory)

1. `overlay` variant is the shell-level loading pattern for route transitions, redirects, and next-page handoff.
2. `panel` variant is for card, form, or table blocks that are actively saving within the current page.
3. `inline` variant is for compact busy feedback near buttons, filters, or row actions.
4. Prefer `SoTLoadingState` over route-local animated dots, ad hoc loading chips, or opacity-only pending presentation.
5. Loading labels must say what the app is doing in plain language, for example `Creating delivery run` or `Checking your sign-in`.

## 3.4 Dashboard Revamp Contract (Mandatory)

Owns:

1. Dashboard layout hierarchy
2. Dashboard copy budget and wording rules
3. Dashboard naming consistency
4. Per-role dashboard content emphasis

Does Not Own:

1. Destination-page workflow rules
2. Loader/action business logic
3. Route authorization rules

Refer To:

1. `docs/guide/ui/UI_CONFORMANCE_MATRIX.md` for route-by-route status

### Core Principle

1. Dashboards must be scan-first, action-first, and instruction-light.
2. The first viewport must make the next action obvious without requiring paragraph reading.
3. Dashboards are operational launchpads, not training pages.

### Shared Layout Contract

1. All dashboards must keep this section order:
   `Top Bar`, `Priority Strip`, `Workbench`, `Signals`, `Quick Actions`, `Reference`
2. `Priority Strip` is for urgent work or state that needs attention now.
3. `Workbench` is the single dominant task area for the role.
4. `Signals` are quiet operational metrics and must not outrank `Priority Strip` or `Workbench`.
5. `Quick Actions` hold high-frequency shortcuts with short verb-first labels.
6. `Reference` holds lower-priority history, summaries, and notes.
7. Urgent rows should prefer compact list or rail presentation over equal-weight card grids.
8. Desktop dashboards should prefer asymmetric hierarchy instead of making every card visually equal.
9. Mobile dashboards must preserve the same priority order without placing long banners before the first action.

### Copy Contract

1. Clarity is more important than shortest possible wording.
2. Use full words when abbreviation reduces understanding.
3. Card support text is optional and must stay to one short sentence.
4. Do not place instructional helper text under every button or link.
5. Detailed workflow explanation belongs on the destination page, blocked state, or empty state.
6. CTA labels must be verb-first and direct, for example `Open Dispatch`, `Review Clearance`, `Open Shift Console`, and `Open My Runs`.
7. Avoid labels that describe process instead of action, for example `Go to`, `Open latest`, `Search and select`, and `Continue process`.

### Naming Dictionary

1. Use `Attendance`, not `Attend`.
2. Use `Pending Acceptance`, not `Pending Accept`.
3. Use `Remit Review`, not `Remit Rev`.
4. Use `Order Pad`, not `Pad Order`.
5. Use one canonical label per destination, queue, and action across all dashboards.
6. Dashboard labels should match destination-page titles as closely as practical.

### Card and Row Contract

1. One dashboard card or row must own one concern only.
2. A dashboard card should contain one title, one main state or value, one short support line if needed, and one primary action if applicable.
3. If a dashboard card needs multiple paragraphs, split the concern or move the explanation out of the dashboard.
4. Monitor data, tutorial copy, and unrelated actions must not compete inside the same card.

### Per-Role Content Mapping

1. `Manager Dashboard` is a control tower:
   priority = approvals and review queues
   workbench = dispatch
   signals = runs, shifts, attendance
2. `Admin Dashboard` is a launchpad:
   priority = setup items and onboarding entry points
   workbench = create and maintain master data
   signals = setup health and recent admin work
3. `Cashier Dashboard` is a focus-state console:
   priority = shift state and charge blockers
   workbench = shift console
   signals = next shift, attendance, payroll snapshot
4. `Rider Dashboard` is a task board:
   priority = do-now work and pending acceptance
   workbench = my runs / check-in lane
   signals = next shift, payroll, attendance

### Dashboard Failure Test

1. A dashboard fails if users must read multiple paragraphs before acting.
2. A dashboard fails if helper text repeats what the label, count, or CTA already says.
3. A dashboard fails if multiple areas compete equally for attention in the first viewport.
4. A dashboard fails if abbreviations or alternate names make the primary action unclear.

## 4. Patch-First Rule

When monitor detects mismatch:

1. Default: patch route/component UI code to align with SoT.
2. Exception: snapshot refresh only when explicitly approved as new source of truth.

Required note for snapshot exception:

1. `source_of_truth = approved new UI`
2. `approved_by`
3. `approval_ref`

## 5. No-Logic-Change Boundary

Allowed:

1. Layout/spacing/typography changes
2. Shared component extraction
3. Visual hierarchy and status-presentation updates

Not allowed under UI refactor objective:

1. Loader/action business-rule changes
2. Decision-state transition changes
3. Data authority changes

## 5.1 Product Module Revamp Contract (Mandatory)

Scope:

1. Applies to `products` module revamp (`list`, `new`, `detail`, `edit`) and supporting product UI components.

UI is free to change:

1. Existing productlist components may be replaced entirely.
2. New page layout, visual hierarchy, and component composition are allowed.
3. New SoT components can be introduced when recurring patterns appear.

Behavior must remain unchanged unless explicitly approved:

1. Retail quantity behavior remains `.25/.50/.75/1.00`.
2. `open-pack` remains manual-only.
3. Retail floor checks remain warning-only (non-blocking).
4. `PACK` vs `RETAIL` stock semantics remain intact.

Implementation rule:

1. Extract mixed behavior logic from UI-only components into route/domain helpers before or during revamp.
2. UI component replacement must not alter server action/loader contracts under the same objective.

Deprecation rule (product UI only):

1. Legacy productlist components may be marked deprecated once replacement routes pass conformance and behavior checks.
2. Deprecated components must not be used as visual authority for new product routes.

## 6. Route Priority Queue

P1 (draft-heavy, inconsistent):

1. `app/routes/store.cashier-variances.tsx`
2. `app/routes/cashier.charges.tsx`
3. `app/routes/store.cashier-ar.tsx`
4. `app/routes/store.rider-variances.tsx`
5. `app/routes/rider.variances.tsx`
6. `app/routes/rider.variance.$id.tsx`
7. `app/routes/store.rider-charges.tsx`

P2:

1. `app/routes/cashier.shift.tsx`
2. `app/routes/runs.$id.summary.tsx`
3. `app/routes/ar._index.tsx`
4. `app/routes/ar.customers.$id.tsx`

P3:

1. Remaining routes in UI conformance matrix marked `PARTIAL`.

## 7. Done Criteria Per Route

1. Uses SoT components where applicable.
2. Passes route-level visual/spec checks.
3. Keeps business logic behavior unchanged.
4. Matrix status is updated in docs when route is upgraded.
