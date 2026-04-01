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
6. App-shell route transitions should prefer a route-family skeleton preview when the target path maps cleanly to a known family.
7. The initial SoT loading preview set is `dashboard`, `operational-list`, and `generic` fallback.
8. If 2 or more routes share the same transition skeleton structure, keep that preview in a shared SoT component instead of duplicating route-local loading markup.

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

## 3.5 Route Family Contracts (Mandatory)

Owns:

1. Non-dashboard route-family layout hierarchy
2. Family-level action priority and section order
3. Family-level noise and density expectations

Does Not Own:

1. Route-specific business logic
2. Loader/action contracts
3. Access-control rules

Refer To:

1. `docs/guide/ui/UI_CONFORMANCE_MATRIX.md` for active route status and rollout focus

### Shared Principle

1. The app should use one visual language, but not one repeated layout for every route.
2. Route layout must follow the user's job on that screen.
3. Reference information must stay visually quieter than the current task.

### Operational List / Inbox

1. Purpose: help users review, sort, filter, and act on operational work.
2. Section order should be:
   `Header`, `Triage Strip`, `Filters / Action Bar`, `Primary Table or List`, `Secondary Context`
3. The table or list is the work surface and must outrank filter chrome.
4. Summary counts and state chips should stay compact and scan-first.
5. Repeated helper text around filters, row actions, and list summaries is not allowed by default.
6. When terminal history exists, actionable rows must stay in the default inbox and history must move to an explicit secondary mode or section.
7. Long operational lists should progressively reveal older rows with low-noise pagination or load-more controls instead of dumping every row at once.
8. Example routes:
   `app/routes/store.dispatch.tsx`
   `app/routes/runs._index.tsx`
   `app/routes/ar._index.tsx`
   `app/routes/cashier.delivery._index.tsx`

### Console / Workspace

1. Purpose: show current state, active work area, and exceptions for a single operator lane.
2. Section order should be:
   `Header`, `Current State`, `Workbench`, `Exceptions`, `History / Reference`
3. Each console route must have one dominant task area.
4. Current state must be visible before historical summaries or reference metrics.
5. Alerts and blockers should stay near the workbench, not scattered across the page.
6. Example routes:
   `app/routes/cashier.shift.tsx`
   `app/routes/store.cashier-shifts.tsx`
   `app/routes/store.payroll.tsx`

### Decision / Detail

1. Purpose: help the user inspect evidence and complete a decision with confidence.
2. Section order should be:
   `Header`, `Decision Summary`, `Evidence / Records`, `Action Area`, `Audit Trail`
3. Summary and action areas must stay above dense evidence tables when possible.
4. Explanatory copy should be short and should support the decision, not retell the whole flow.
5. Example routes:
   `app/routes/runs.$id.dispatch.tsx`
   `app/routes/store.clearance-opening-batches.tsx`
   `app/routes/rider.variance.$id.tsx`

### Admin Form / Library

1. Purpose: create, edit, and maintain master data with low-noise task framing.
2. Section order should be:
   `Header`, `Primary Task`, `Form or Table`, `Secondary Tools`, `Reference Notes`
3. The form or table should stay central; library notes and support tools must not compete with it.
4. Guidance copy should be present only when the task is blocked, risky, or compliance-sensitive.
5. Example routes:
   `app/routes/products._index.tsx`
   `app/routes/products.new.tsx`
   `app/routes/creation.riders.tsx`
   `app/routes/creation.provinces.tsx`

### Public / Auth

1. Purpose: help the user complete one entry task without unnecessary chrome.
2. Public and auth routes should keep one clear task, one form focus, and minimal supporting copy.
3. Product-level navigation, dashboard-style sections, or operational metrics do not belong here.
4. Dev-only credential or OTP helper copy must stay scoped to local/dev environments.
5. Example routes:
   `app/routes/login.tsx`
   `app/routes/login.otp.tsx`

## 3.6 Cross-Cutting Route Rules (Mandatory)

### Responsive Fit Rule

1. No card, tile, row, or action cluster may crush text into unreadable narrow columns at common desktop widths.
2. Badges, chips, and secondary metadata must stack, wrap, or demote before the main text becomes unreadable.
3. Desktop layouts should preserve clear content width before adding more parallel columns.
4. Mobile layouts must preserve task priority, not simply stack every section without hierarchy.

### Noise Budget Rule

1. Section subtitles and support text must stay to one short sentence.
2. Do not repeat the same operational fact across adjacent sections unless the repeated view changes the user's decision.
3. Helper text is allowed by default only for blocked states, empty states, destructive actions, or compliance-sensitive actions.
4. If a workbench already shows the important state, signals and reference panels must not restate it in full.

### Action Hierarchy Rule

1. Every route must have one dominant task area in the first viewport.
2. Every route should make the primary action obvious before secondary utilities.
3. Secondary actions must move into action bars, quick actions, or reference panels instead of competing with the main work.
4. Metrics, historical summaries, and policy notes must not visually outrank the current task.

### Density Rule

1. Compress metadata before adding more cards, notes, or badges.
2. In tables, keep the columns needed for decision and action visible first; lower-value metadata should collapse or move to secondary rows.
3. In forms, put required task inputs first and move longer guidance into compact notes, alerts, or destination help.
4. Reference panels should prefer quieter styling and compact data rows over card-heavy repetition.

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

## 6. Route Family Rollout Waves

Wave 0: Dashboard baseline + SoT extension

1. Lock dashboard family direction before broad non-dashboard rollout.
2. Update `docs/guide/ui/UI_SOT.md` first.
3. Align `docs/guide/ui/UI_CONFORMANCE_MATRIX.md` second.

Wave 1: Operational List / Inbox pilots

1. `app/routes/store.dispatch.tsx`
2. `app/routes/ar._index.tsx`
3. `app/routes/runs._index.tsx`
4. `app/routes/cashier.delivery._index.tsx`

Wave 2: Console / Workspace routes

1. `app/routes/cashier.shift.tsx`
2. `app/routes/store.cashier-shifts.tsx`
3. `app/routes/store.payroll.tsx`

Wave 3: Heavy-noise decision and review routes

1. `app/routes/runs.$id.dispatch.tsx`
2. `app/routes/store.clearance-opening-batches.tsx`
3. `app/routes/store.cashier-ar.tsx`
4. `app/routes/store.cashier-variances.tsx`
5. `app/routes/cashier.charges.tsx`
6. `app/routes/store.rider-variances.tsx`
7. `app/routes/rider.variances.tsx`
8. `app/routes/rider.variance.$id.tsx`
9. `app/routes/store.rider-charges.tsx`

Wave 4: Admin Form / Library partials

1. `app/routes/products._index.tsx`
2. `app/routes/products.new.tsx`
3. `app/routes/products.$productId.tsx`
4. `app/routes/products.$productId.edit.tsx`
5. `app/routes/creation.riders.tsx`
6. `app/routes/creation.provinces.tsx`

Wave 5: Final conformance pass

1. Remaining routes in the UI conformance matrix still marked `PARTIAL`
2. Responsive fit and mobile compression pass
3. Copy and helper-text compression pass
4. Matrix status refresh in the same objective whenever a covered route is touched

## 7. Done Criteria Per Route

1. Uses SoT components where applicable.
2. Passes route-level visual/spec checks.
3. Keeps business logic behavior unchanged.
4. Matrix status is updated in docs when route is upgraded.
