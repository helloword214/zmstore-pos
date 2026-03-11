# UI Conformance Matrix (Baseline)

Status: BASELINE SNAPSHOT  
Owner: POS Platform  
Captured On: 2026-03-02  
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
| `app/routes/store._index.tsx` | Manager dashboard | ALIGNED | REMIT | compact inbox panel uses subtle color accents and simple row actions, and dashboard loader metrics now avoid route-level `any` bypass for status/count and grouped cash math paths | decision queues remain first with lower visual noise; monitor cards are toned down as secondary context | P2 |
| `app/routes/_index.tsx` | Admin dashboard | ALIGNED | REMIT | creation-only colorful shell and creation shortcuts are aligned to SoT card/button/focus patterns | admin lane is scoped to creation-only pages, with manager operations intentionally excluded | P2 |
| `app/routes/customers._index.tsx` | Admin customer list | ALIGNED | REMIT | SoT customer directory is refreshed with compact metrics, action/search bar, and scrollable SoT table including profile/edit/pricing shortcuts under `ctx=admin` | keep list row metadata compact as customer volume grows | P2 |
| `app/routes/customers.new.tsx` | Admin customer create | ALIGNED | REMIT | SoT non-dashboard header + card/action/form primitives are applied with admin-context back/redirect mapping and no-key Google Maps link-to-coordinate capture (`geoLat`/`geoLng`) | keep address-row metadata compact as map hints expand | P2 |
| `app/routes/customers.$id.tsx` | Admin customer profile | ALIGNED | REMIT | flattened standalone profile route now uses SoT non-dashboard header + profile card/data primitives with admin context propagation | keep profile metrics and notes concise as fields expand | P2 |
| `app/routes/customers.$id_.edit.tsx` | Admin customer edit | ALIGNED | REMIT | flattened edit route uses SoT non-dashboard header + alert/card/form/button patterns with admin-context return flow | none significant | P2 |
| `app/routes/customers.$id_.pricing.tsx` | Admin pricing list | ALIGNED | REMIT | flattened pricing list route uses SoT non-dashboard header + alert/card/form/action bar patterns with context-safe rule actions | keep row metadata concise at higher rule volume | P2 |
| `app/routes/customers.$id_.pricing_.$ruleId.tsx` | Admin pricing rule edit | ALIGNED | REMIT | flattened pricing-rule edit route uses SoT non-dashboard header + alert/card/form/action bar with role/context-safe redirects | none significant | P2 |
| `app/routes/creation._index.tsx` | Admin product option library | ALIGNED | REMIT | compact SoT workspace includes tabbed global + category sections, category lifecycle controls (create/rename/archive/unarchive), and internal scroll lists while preserving creation endpoints | monitor list density once option counts become high across categories | P2 |
| `app/routes/products._index.tsx` | Product list (split baseline) | PARTIAL | REMIT | list shell now uses SoT non-dashboard header + action bar + card/empty-state wrappers while preserving existing filter/action behavior; brand/location/category filters now use shared SoT dropdown controls (non-deletable), target/indication filters are read-only, row actions are simplified to view-first flow, create/edit route out to dedicated pages, and fetcher/date handling no longer relies on route-level `any`/debug logs | remaining drift is concentrated in dense filter controls and final spacing/token harmonization across mobile/desktop list states | P1 |
| `app/routes/products.new.tsx` | Product create (active) | PARTIAL | REMIT | route now uses SoT non-dashboard header and shared upsert form with SoT alert/action wrappers while keeping current product-create behavior | run final mobile pass for dense form controls and helper text rhythm | P1 |
| `app/routes/products.$productId.tsx` | Product detail (active) | PARTIAL | REMIT | detail page now keeps a calm header action bar (`Back`, `Edit`) and moves operational/destructive controls (`Open Pack`, `Delete`) into an isolated Operations card under the page header | validate compact card density on small screens and long tag lists | P1 |
| `app/routes/products.$productId.edit.tsx` | Product edit (active) | PARTIAL | REMIT | edit route now follows SoT header/action shell and shared upsert form wrappers without changing update workflow | complete end-to-end edge-case pass after list shell hardening | P1 |
| `app/routes/creation.riders.tsx` | Admin rider creation | PARTIAL | REMIT | SoT non-dashboard header + SoT card/button/form controls are applied and rider filters/forms now use shared SoT dropdown/select controls; row edit grid is still dense on narrow layouts | tighten row-column collapse behavior on smaller screens | P2 |
| `app/routes/creation.vehicles.tsx` | Admin vehicle creation | ALIGNED | REMIT | province-style SoT pattern is applied (search/status toolbar, focused create/edit panels, paged table, consistent row actions) with existing vehicle/profile logic preserved | monitor if advanced filters are needed as fleet volume grows | P2 |
| `app/routes/creation.provinces.tsx` | Admin province creation | PARTIAL | REMIT | SoT non-dashboard header + SoT input/button controls are applied and status filtering now uses shared SoT dropdown controls; inline rename/code editing alignment still needs polish | align inline edit controls for stable row height | P2 |
| `app/routes/creation.areas.tsx` | Admin area hierarchy creation | ALIGNED | REMIT | compact hierarchy UX is applied with sticky navigator, single active workspace tab, shared SoT dropdown controls, and internal scroll tables while preserving strict parent-child validation | consider server-side pagination if area records become very large | P2 |
| `app/routes/creation.opening-ar-batches.tsx` | Opening balance batch encode | PARTIAL | N/A | admin opening-batch encode server paths now avoid route-level `any` bypass for batch grouping and case/claim create payload writes | keep CSV/itemized composer hints concise as row volume grows | P2 |
| `app/routes/cashier._index.tsx` | Cashier dashboard | PARTIAL | REMIT | control sizing mostly aligned; hierarchy still mixed in card metadata | maintain one CTA emphasis level across all action cards | P2 |
| `app/routes/login.tsx` | Public auth entry | PARTIAL | N/A | SoT card/form/alert/button + focus-visible controls are applied; page intentionally has no non-dashboard header | keep dev-credentials helper scoped to local/dev environments | P3 |
| `app/routes/cashier.pos._index.tsx` | Cashier queue (walk-in) | PARTIAL | REMIT | SoT header + action bar + alert + table/status are applied; row action controls still use route-local confirmation flows | keep action/control rhythm consistent with cashier remit list views | P2 |
| `app/routes/orders.new.tsx` | Order creation action (PAD submit) | ALIGNED | N/A | server-side order create payload handling now avoids route-level `any` bypass with typed incoming item validation and enum-safe order/channel writes | monitor payload-contract docs if client fields evolve | P2 |
| `app/routes/pad-order._index.tsx` | Order pad workspace | PARTIAL | N/A | order-pad client paths now avoid route-level `any` bypass for fetcher reset, barcode lookup, keyboard focus guard, and customer selection handling | keep mobile cart sheet density and helper copy concise | P2 |
| `app/routes/cashier.$id.tsx` | Cashier settlement (walk-in) | PARTIAL | REMIT | settlement loader/action now avoids route-level `any` bypass, with typed clearance snapshot parsing and lock/decision guard handling kept intact | keep dense payment-side helper text compressed on small screens | P2 |
| `app/routes/rider._index.tsx` | Rider dashboard | PARTIAL | CHECKIN | control sizing mostly aligned; helper copy density still uneven | keep seller/rider panel emphasis balanced as cards evolve | P2 |
| `app/routes/store.dispatch.tsx` | Dispatch queue | PARTIAL | REMIT | SoT dropdown controls now cover list sort + run assignment, and dispatch loader/action typing now runs without route-level `any` bypass | section hierarchy can be tighter | P2 |
| `app/routes/runs._index.tsx` | Runs index | PARTIAL | REMIT | SoT header + action bar + table/status badge are applied; action column styling is still route-local, and run status/filter typing now avoids route-level `any` casts | keep list hierarchy consistent with dispatch/remit list pages | P2 |
| `app/routes/runs.new.tsx` | Run create form | PARTIAL | REMIT | SoT header/card/form field/alert/button are applied; select control still uses local wrapper styling | align select/input shell tokens with other manager form routes | P2 |
| `app/routes/runs.$id.dispatch.tsx` | Run staging | PARTIAL | REMIT | SoT header + card + action button patterns are applied, and staging loader/action now use typed loadout + fulfillment-status fallback handling without route-level `any` bypass | staging flow reads clearer; final token compression is still needed in loadout rows | P2 |
| `app/routes/runs.$id.summary.tsx` | Run summary | ALIGNED | REMIT | SoT non-dashboard header + alerts + status badges + stock table primitives are applied, and summary loader parsing now avoids route-level `any` bypass (`riderCheckinSnapshot`, `loadoutSnapshot`, clearance case mapping) | keep recap helper copy concise as totals evolve | P2 |
| `app/routes/runs.$id.rider-checkin.tsx` | Rider check-in + CSS | ALIGNED | CHECKIN | SoT non-dashboard header applied, and rider-checkin loader/action payload handling now avoids route-level `any` bypass for snapshot/case parsing and submit-clearance guards | reduce repeated hints in dense rows | P2 |
| `app/routes/store.clearance.tsx` | Clearance inbox | ALIGNED | CHECKIN | SoT non-dashboard header + card/table/status badge patterns are applied | no major drift; monitor tab-filter clarity only | P3 |
| `app/routes/store.clearance_.$caseId.tsx` | Clearance decision | ALIGNED | CHECKIN | SoT non-dashboard header applied, and decision loader/action typing now avoids route-level `any` bypass in label parsing and write paths | none significant | P3 |
| `app/routes/store.clearance-opening-batches.tsx` | Opening balance clearance batch lane | PARTIAL | CHECKIN | SoT non-dashboard header + table/form primitives are applied, and opening-batch manager action paths now avoid route-level `any` bypass with enum-safe decision/case status writes | keep bulk-row scan density readable on compact screens | P2 |
| `app/routes/runs.$id.remit.tsx` | Manager remit | ALIGNED | REMIT | SoT non-dashboard header + cards/alerts/buttons + stock table primitives are applied, and remit loader/action typing now avoids route-level `any` bypass on clearance status handling | no major drift; continue trimming dense per-line helper text | P3 |
| `app/routes/cashier.delivery._index.tsx` | Cashier run list | PARTIAL | REMIT | SoT header + table/status badges are applied; remit action button remains route-local | state labels can be clearer at first glance | P2 |
| `app/routes/cashier.delivery.$runId.tsx` | Cashier remit hub | ALIGNED | REMIT | SoT non-dashboard header + cards/alerts/status badges + remit table primitives are applied, and remit loader/action typing now runs without route-level `any` bypass | row-level helper text can still be trimmed | P2 |
| `app/routes/delivery-remit.$id.tsx` | Cashier order remit | ALIGNED | REMIT | SoT non-dashboard header applied; remit loader/action now use typed frozen-line + enum-safe settlement paths without route-level `any` bypass | none significant | P3 |
| `app/routes/ar._index.tsx` | AR index | PARTIAL | REMIT | SoT header + form field + table/button are applied; metadata density remains broad | visual priority still spread across list metadata | P2 |
| `app/routes/ar.customers.$id.tsx` | AR ledger | ALIGNED | REMIT | SoT non-dashboard header + alert/card/form/table/status badge primitives are applied | keep receipt/proof helper text concise in activity rows | P2 |
| `app/routes/cashier.shift.tsx` | Cashier shift console | PARTIAL | REMIT | SoT non-dashboard header applied, and shift loader/action typing now runs without route-level `any` bypass on drawer transaction and close-submit paths | keep status emphasis consistent across cards and chips | P2 |
| `app/routes/cashier.shift-history.tsx` | Cashier shift history | PARTIAL | REMIT | SoT non-dashboard shell and shared dropdown filters are applied (`status`, `cashier`), with existing audit table behavior preserved | table density and action hierarchy still need final polish on compact screens | P2 |
| `app/routes/store.cashier-shifts.tsx` | Shift manager panel | PARTIAL | REMIT | SoT non-dashboard header applied, and shift aggregate/action server paths now avoid route-level `any` bypass with enum-safe status/resolution writes | action priority can be clearer | P2 |
| `app/routes/store.cashier-variances.tsx` | Cashier variance decision | PARTIAL | REMIT | SoT header + card/table/status primitives are applied, and variance loader parsing now avoids route-level `any` bypass for status filters and denomination snapshots | top-level hierarchy is consistent; denoms/details copy can still be compressed | P2 |
| `app/routes/cashier.charges.tsx` | Cashier charge acknowledgment | PARTIAL | REMIT | SoT header + card/table/status primitives are applied; detail form area still text-heavy | action flow is clearer, but note/ack blocks still compete for attention | P2 |
| `app/routes/store.cashier-ar.tsx` | Cashier AR tagging | PARTIAL | REMIT | SoT header + card/table/alert/button primitives are applied; per-row plan form is still dense | tagging workflow is more consistent, but row metadata can still be trimmed | P2 |
| `app/routes/store.payroll.tsx` | Payroll settlement | PARTIAL | REMIT | SoT header + alerts + form fields/input + table/status badges are applied, and payroll settlement action now avoids route-level `any` bypass with enum-safe charge/variance status updates | simplify instructional copy bands | P2 |
| `app/routes/store.rider-variances.tsx` | Rider variance manager review | PARTIAL | REMIT | SoT header + card/table/status/button primitives are applied and decision resolution now uses shared SoT dropdown controls; decision column remains dense | manager decision flow is clearer, but awaiting/history details still need compression | P2 |
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

Product revamp parity checks (when touched):

1. `.25/.50/.75/1.00` retail step behavior remains unchanged.
2. `open-pack` remains manual trigger only.
3. price floor behavior remains warning-only (no hard block).
4. `PACK` vs `RETAIL` stock cues remain explicit in UI.
5. list rows provide stable deep-link to product detail route once available.

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
