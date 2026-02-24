# UI Conformance Matrix (Baseline)

Status: BASELINE SNAPSHOT  
Owner: POS Platform  
Captured On: 2026-02-24  
Source: Active route scan + canonical flow mapping + golden reference comparison

## 1. Status Legend

1. `ALIGNED`: follows default shell/tokens with minor or no drift.
2. `PARTIAL`: mostly aligned but has visible token or density drift.
3. `NEEDS_HARDENING`: clear deviation from baseline contract; prioritize migration.

## 2. Golden Reference Anchors

1. `app/routes/runs.$id.rider-checkin.tsx`: canonical interaction for status-first receipt workflow and lock/pending behavior.
2. `app/routes/runs.$id.remit.tsx`: canonical interaction for recap cards, financial read-only presentation, and manager action framing.

## 3. Route Baseline

| Route | Flow Area | Baseline | Reference Fit | Main drift | UX gap summary | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| `app/routes/store._index.tsx` | Manager dashboard | PARTIAL | REMIT | control size drift reduced but still mixed chip density | top-bar/dashboard action scale is aligned; continue token hardening for metric chips | P2 |
| `app/routes/cashier._index.tsx` | Cashier dashboard | PARTIAL | REMIT | control sizing mostly aligned; hierarchy still mixed in card metadata | maintain one CTA emphasis level across all action cards | P2 |
| `app/routes/rider._index.tsx` | Rider dashboard | PARTIAL | CHECKIN | control sizing mostly aligned; helper copy density still uneven | keep seller/rider panel emphasis balanced as cards evolve | P2 |
| `app/routes/store.dispatch.tsx` | Dispatch queue | PARTIAL | REMIT | Title/pill usage not fully standardized | section hierarchy can be tighter | P2 |
| `app/routes/runs.$id.dispatch.tsx` | Run staging | NEEDS_HARDENING | NONE | Legacy spacing/layout profile | weak scan hierarchy and mixed spacing | P1 |
| `app/routes/runs.$id.summary.tsx` | Run summary | PARTIAL | REMIT | Typography and status labeling drift | summary cards need stronger status-first pattern | P2 |
| `app/routes/runs.$id.rider-checkin.tsx` | Rider check-in + CSS | ALIGNED | CHECKIN | high helper text density only | reduce repeated hints in dense rows | P2 |
| `app/routes/store.clearance.tsx` | Clearance inbox | ALIGNED | CHECKIN | None significant | minor copy tightening only | P3 |
| `app/routes/store.clearance_.$caseId.tsx` | Clearance decision | ALIGNED | CHECKIN | None significant | none significant | P3 |
| `app/routes/runs.$id.remit.tsx` | Manager remit | ALIGNED | REMIT | None significant | none significant | P3 |
| `app/routes/cashier.delivery._index.tsx` | Cashier run list | PARTIAL | REMIT | Header/section token style drift | state labels can be clearer at first glance | P2 |
| `app/routes/cashier.delivery.$runId.tsx` | Cashier remit hub | ALIGNED | REMIT | Noise density can still be reduced | row-level helper text can be trimmed | P2 |
| `app/routes/delivery-remit.$id.tsx` | Cashier order remit | ALIGNED | REMIT | None significant | none significant | P3 |
| `app/routes/ar._index.tsx` | AR index | PARTIAL | REMIT | Expanded title scale + mixed header density | visual priority too spread out | P2 |
| `app/routes/ar.customers.$id.tsx` | AR ledger | PARTIAL | REMIT | Expanded title scale + dense helper copy | form/table split is good but too text-heavy | P2 |
| `app/routes/cashier.shift.tsx` | Cashier shift console | PARTIAL | REMIT | Inconsistent title hierarchy and status chips | operational status emphasis is uneven | P2 |
| `app/routes/store.cashier-shifts.tsx` | Shift manager panel | PARTIAL | REMIT | Typography/pill consistency drift | action priority can be clearer | P2 |
| `app/routes/store.cashier-variances.tsx` | Cashier variance decision | NEEDS_HARDENING | NONE | Legacy admin shell (`bg-slate-50`, `px-4`) | page still uses older dense admin look | P1 |
| `app/routes/cashier.charges.tsx` | Cashier charge acknowledgment | NEEDS_HARDENING | NONE | Legacy admin shell and repeated inline pill styles | poor visual hierarchy in detail actions | P1 |
| `app/routes/store.cashier-ar.tsx` | Cashier AR tagging | NEEDS_HARDENING | NONE | Legacy admin shell and verbose metadata | too many row-level notes for one task | P1 |
| `app/routes/store.payroll.tsx` | Payroll settlement | PARTIAL | REMIT | Mostly aligned shell; note density is high | simplify instructional copy bands | P2 |
| `app/routes/store.rider-variances.tsx` | Rider variance manager review | NEEDS_HARDENING | NONE | Legacy admin shell + mixed chip styles | needs recap-first and cleaner decision flow | P1 |
| `app/routes/rider.variances.tsx` | Rider pending acceptance list | NEEDS_HARDENING | NONE | Legacy shell and non-standard spacing | action intent is clear but style is outdated | P1 |
| `app/routes/rider.variance.$id.tsx` | Rider variance acceptance detail | NEEDS_HARDENING | NONE | Legacy shell + expanded emphasis styles | consolidate warning/action hierarchy | P1 |
| `app/routes/store.rider-charges.tsx` | Rider charge tracking/tagging | NEEDS_HARDENING | NONE | Legacy admin shell + repeated local style blocks | table density and controls need simplification | P1 |

## 4. Noise Hotspots (Observed)

High helper/meta-note density was observed in these routes:

1. `app/routes/cashier.delivery.$runId.tsx`
2. `app/routes/store.payroll.tsx`
3. `app/routes/cashier.shift.tsx`
4. `app/routes/store.cashier-ar.tsx`
5. `app/routes/runs.$id.rider-checkin.tsx`

Target: reduce repeated notes and duplicate instructional text first, before adding new UI elements.

## 5. Migration Batches

1. Batch A (P1): run staging + cashier/rider variance/charge pages.
2. Batch B (P2): dispatch summary, AR index/ledger, shift pages, payroll.
3. Batch C (P3): final conformance polish on already aligned pages.

## 6. UX Gap Checklist (Per Route Update)

When a route is modified, verify:

1. shell matches contract (`bg-[#f7f7fb]`, `px-5 py-6`, card hierarchy).
2. status is readable before explanatory copy.
3. locked/disabled/pending states are explicit.
4. helper text stays within noise budget.
5. desktop and mobile layout keep primary action visible.

## 7. Update Rule

When a covered route is edited:

1. Re-evaluate its conformance status in this matrix.
2. Record the new status in the same PR.
3. Keep route entries in this file aligned with the active-route list in `docs/guide/ui/UI_AUTOMATION_GUIDE.md`.

## 8. Automation Incident Handling Contract

This matrix is consumed by monitor flow reports. Severity handling is standardized:

1. `PRIMARY_MISMATCH`: Rider Dashboard or Cashier Dashboard visual drift.
2. `SECONDARY_MISMATCH`: non-primary route visual drift.
3. `INFRA_BLOCKED`: preflight/setup failures that prevent reliable UI comparison.

Action expectations:

1. `PRIMARY_MISMATCH`: fail-fast and escalate for same-day repair.
2. `SECONDARY_MISMATCH`: keep monitor cadence active; assign to repair backlog.
3. `INFRA_BLOCKED`: attempt auto-recovery first, then publish blocked incident with exact recovery step.

## 9. Refactor Mandate (Draft-to-Target Upgrade)

Routes tagged `NEEDS_HARDENING` are considered active refactor targets, not optional cleanup.

Execution requirements:

1. Prefer shared UI component extraction when repeated visual patterns exist across target routes.
2. Keep logic untouched: loader/action/business-rule behavior must remain equivalent.
3. Mark route as upgraded only after:
4. route/component patch merged
5. targeted specs rerun and recorded
6. matrix status updated in the same PR

Current priority execution set:

1. `app/routes/store.cashier-variances.tsx`
2. `app/routes/cashier.charges.tsx`
3. `app/routes/store.cashier-ar.tsx`
4. `app/routes/store.rider-variances.tsx`
5. `app/routes/rider.variances.tsx`
6. `app/routes/rider.variance.$id.tsx`
7. `app/routes/store.rider-charges.tsx`
