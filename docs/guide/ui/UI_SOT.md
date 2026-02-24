# UI SoT (Source of Truth)

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-02-24

## 1. Purpose

Define one canonical UI system for route refactors and automation-driven UI upgrades.
This SoT is for UI/UX structure, spacing, typography, and reusable components.
It must not change business logic.

## 2. Canonical Design References

Use these routes as visual interaction anchors:

1. `app/routes/runs.$id.rider-checkin.tsx`
2. `app/routes/runs.$id.remit.tsx`
3. `app/routes/store._index.tsx`

## 3. SoT Component Set

Primary reusable components (minimum baseline):

1. `app/components/ui/SoTButton.tsx`
2. `app/components/ui/SoTInput.tsx`
3. `app/components/ui/SoTCard.tsx`
4. `app/components/ui/SoTSectionHeader.tsx`
5. `app/components/ui/SoTStatusPill.tsx`
6. `app/components/ui/SoTDropdown.tsx`

Rule:

1. If repeated UI pattern appears in 2+ routes, extract shared SoT component first.
2. Prefer shared component usage over route-local class duplication.

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
