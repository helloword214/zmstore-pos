# UI Conformance Matrix (Baseline)

Status: BASELINE SNAPSHOT  
Owner: POS Platform  
Captured On: 2026-02-26  
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
| `app/routes/login.tsx` | Public auth entry | PARTIAL | N/A | SoT card/form/alert/button + focus-visible controls are applied; page intentionally has no non-dashboard header | keep dev-credentials helper scoped to local/dev environments | P3 |
| `app/routes/cashier.pos._index.tsx` | Cashier queue (walk-in) | PARTIAL | REMIT | SoT header + action bar + alert + table/status are applied; row action controls still use route-local confirmation flows | keep action/control rhythm consistent with cashier remit list views | P2 |
| `app/routes/rider._index.tsx` | Rider dashboard | PARTIAL | CHECKIN | control sizing mostly aligned; helper copy density still uneven | keep seller/rider panel emphasis balanced as cards evolve | P2 |
| `app/routes/store.dispatch.tsx` | Dispatch queue | PARTIAL | REMIT | Title/pill usage not fully standardized | section hierarchy can be tighter | P2 |
| `app/routes/runs._index.tsx` | Runs index | PARTIAL | REMIT | SoT header + action bar + table/status badge are applied; action column styling is still route-local | keep list hierarchy consistent with dispatch/remit list pages | P2 |
| `app/routes/runs.new.tsx` | Run create form | PARTIAL | REMIT | SoT header/card/form field/alert/button are applied; select control still uses local wrapper styling | align select/input shell tokens with other manager form routes | P2 |
| `app/routes/runs.$id.dispatch.tsx` | Run staging | PARTIAL | REMIT | SoT header + card + action button patterns are applied; loadout row controls still mix route-local density | staging flow reads clearer; final token compression is still needed in loadout rows | P2 |
| `app/routes/runs.$id.summary.tsx` | Run summary | ALIGNED | REMIT | SoT non-dashboard header + alerts + status badges + stock table primitives are applied | keep recap helper copy concise as totals evolve | P2 |
| `app/routes/runs.$id.rider-checkin.tsx` | Rider check-in + CSS | ALIGNED | CHECKIN | SoT non-dashboard header applied; helper text density remains high | reduce repeated hints in dense rows | P2 |
| `app/routes/store.clearance.tsx` | Clearance inbox | ALIGNED | CHECKIN | SoT non-dashboard header + card/table/status badge patterns are applied | no major drift; monitor tab-filter clarity only | P3 |
| `app/routes/store.clearance_.$caseId.tsx` | Clearance decision | ALIGNED | CHECKIN | SoT non-dashboard header applied; no major drift | none significant | P3 |
| `app/routes/runs.$id.remit.tsx` | Manager remit | ALIGNED | REMIT | SoT non-dashboard header + cards/alerts/buttons + stock table primitives are applied | no major drift; continue trimming dense per-line helper text | P3 |
| `app/routes/cashier.delivery._index.tsx` | Cashier run list | PARTIAL | REMIT | SoT header + table/status badges are applied; remit action button remains route-local | state labels can be clearer at first glance | P2 |
| `app/routes/cashier.delivery.$runId.tsx` | Cashier remit hub | ALIGNED | REMIT | SoT non-dashboard header + cards/alerts/status badges + remit table primitives are applied | row-level helper text can still be trimmed | P2 |
| `app/routes/delivery-remit.$id.tsx` | Cashier order remit | ALIGNED | REMIT | SoT non-dashboard header applied; no major drift | none significant | P3 |
| `app/routes/ar._index.tsx` | AR index | PARTIAL | REMIT | SoT header + form field + table/button are applied; metadata density remains broad | visual priority still spread across list metadata | P2 |
| `app/routes/ar.customers.$id.tsx` | AR ledger | ALIGNED | REMIT | SoT non-dashboard header + alert/card/form/table/status badge primitives are applied | keep receipt/proof helper text concise in activity rows | P2 |
| `app/routes/cashier.shift.tsx` | Cashier shift console | PARTIAL | REMIT | SoT non-dashboard header applied; operational status cues are still uneven | keep status emphasis consistent across cards and chips | P2 |
| `app/routes/store.cashier-shifts.tsx` | Shift manager panel | PARTIAL | REMIT | SoT non-dashboard header applied; action hierarchy can still tighten | action priority can be clearer | P2 |
| `app/routes/store.cashier-variances.tsx` | Cashier variance decision | PARTIAL | REMIT | SoT header + card/table/status primitives are applied; detail panel metadata remains dense | top-level hierarchy is consistent; denoms/details copy can still be compressed | P2 |
| `app/routes/cashier.charges.tsx` | Cashier charge acknowledgment | PARTIAL | REMIT | SoT header + card/table/status primitives are applied; detail form area still text-heavy | action flow is clearer, but note/ack blocks still compete for attention | P2 |
| `app/routes/store.cashier-ar.tsx` | Cashier AR tagging | PARTIAL | REMIT | SoT header + card/table/alert/button primitives are applied; per-row plan form is still dense | tagging workflow is more consistent, but row metadata can still be trimmed | P2 |
| `app/routes/store.payroll.tsx` | Payroll settlement | PARTIAL | REMIT | SoT header + alerts + form fields/input + table/status badges are applied; helper copy remains dense | simplify instructional copy bands | P2 |
| `app/routes/store.rider-variances.tsx` | Rider variance manager review | PARTIAL | REMIT | SoT header + card/table/status/button primitives are applied; decision column remains dense | manager decision flow is clearer, but awaiting/history details still need compression | P2 |
| `app/routes/rider.variances.tsx` | Rider pending acceptance list | PARTIAL | CHECKIN | SoT header + card/table/button/status primitives are applied; row copy is still slightly verbose | acceptance intent is clearer, with minor metadata tightening still needed | P2 |
| `app/routes/rider.variance.$id.tsx` | Rider variance acceptance detail | PARTIAL | CHECKIN | SoT header + card/alert/button/status primitives are applied; info stack still has dense helper text | acceptance flow is consistent, with minor content compression pending | P2 |
| `app/routes/store.rider-charges.tsx` | Rider charge tracking/tagging | PARTIAL | REMIT | SoT header + card/table/status/button primitives are applied; per-row action form remains dense | table readability is improved; control and note density still needs simplification | P2 |

## 4. Noise Hotspots (Observed)

High helper/meta-note density was observed in these routes:

1. `app/routes/store.payroll.tsx`
2. `app/routes/cashier.shift.tsx`
3. `app/routes/store.cashier-ar.tsx`
4. `app/routes/runs.$id.rider-checkin.tsx`
5. `app/routes/runs.$id.dispatch.tsx`

Target: reduce repeated notes and duplicate instructional text first, before adding new UI elements.

## 5. Migration Batches

1. Batch A (Completed): former P1 run staging + cashier/rider variance/charge routes are now `PARTIAL`.
2. Batch B (P2 active): dispatch summary, AR index/ledger, shift pages, payroll, and density cleanup on newly hardened variance/charge routes.
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
