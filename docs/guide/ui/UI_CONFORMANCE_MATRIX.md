# UI Conformance Matrix (Baseline)

Status: BASELINE SNAPSHOT  
Owner: POS Platform  
Captured On: 2026-03-02  
Source: Active route scan + canonical flow mapping + golden reference comparison

## 1. Status Legend

1. `ALIGNED`: follows default shell/tokens with minor or no drift.
2. `PARTIAL`: mostly aligned but has visible token or density drift.
3. `NEEDS_HARDENING`: clear deviation from baseline contract; prioritize migration.

## 1.1 Roadmap Boundary

1. This matrix owns route-level baseline status and concise gap notes.
2. Monthly rollout sequencing, active wave tracking, and completion rollups belong to `UI_REVAMP_ROADMAP.md`.
3. When a route is finished for the current revamp campaign, keep the lasting route note here and move the active-tracker summary to the roadmap log.

## 2. Golden Reference Anchors

1. `app/routes/runs.$id.rider-checkin.tsx`: canonical interaction for status-first receipt workflow and lock/pending behavior.
2. `app/routes/runs.$id.remit.tsx`: canonical interaction for recap cards, financial read-only presentation, and manager action framing.

## 3. Route Baseline

| Route | Flow Area | Baseline | Reference Fit | Main drift | UX gap summary | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| `app/routes/store._index.tsx` | Manager dashboard | ALIGNED | REMIT | control-tower layout now uses a compact priority strip, a single dispatch workbench, quieter signal cards, short verb-first actions, and a dashboard-family route-transition skeleton while keeping typed manager metrics intact | manager actions are scan-first and inbox-first; keep specialized lanes linked from their hub pages instead of promoting them into the top dashboard queue | P2 |
| `app/routes/_index.tsx` | Admin dashboard | ALIGNED | REMIT | launchpad layout now replaces the hero/tutorial feel with concise start-here rows, primary create tiles, and calmer support/reference panels | admin lane is now action-first; keep lower-frequency support workflows out of the primary launch zone | P2 |
| `app/routes/customers._index.tsx` | Admin customer list | ALIGNED | REMIT | SoT customer directory is refreshed with compact metrics, action/search bar, and scrollable SoT table including profile/edit/pricing shortcuts under `ctx=admin` | keep list row metadata compact as customer volume grows | P2 |
| `app/routes/customers.new.tsx` | Admin customer create | ALIGNED | REMIT | SoT non-dashboard header + card/action/form primitives are applied with admin-context back/redirect mapping and no-key Google Maps link-to-coordinate capture (`geoLat`/`geoLng`), and customer-create action typing now avoids route-level `any` bypass in address payload parsing/update assignment | keep address-row metadata compact as map hints expand | P2 |
| `app/routes/customers.$id.tsx` | Admin customer profile | ALIGNED | REMIT | flattened standalone profile route now uses SoT non-dashboard header + profile card/data primitives with admin context propagation | keep profile metrics and notes concise as fields expand | P2 |
| `app/routes/customers.$id_.edit.tsx` | Admin customer edit | ALIGNED | REMIT | flattened edit route uses SoT non-dashboard header + alert/card/form/button patterns with admin-context return flow | none significant | P2 |
| `app/routes/customers.$id_.pricing.tsx` | Admin pricing list | ALIGNED | REMIT | flattened pricing list route uses SoT non-dashboard header + alert/card/form/action bar patterns with context-safe rule actions, and pricing helper typing now avoids route-level `any` bypass | keep row metadata concise at higher rule volume | P2 |
| `app/routes/customers.$id_.pricing_.$ruleId.tsx` | Admin pricing rule edit | ALIGNED | REMIT | flattened pricing-rule edit route uses SoT non-dashboard header + alert/card/form/action bar with role/context-safe redirects | none significant | P2 |
| `app/routes/creation._index.tsx` | Admin product option library | ALIGNED | REMIT | compact SoT workspace includes tabbed global + category sections, category lifecycle controls (create/rename/archive/unarchive), and internal scroll lists while preserving creation endpoints | monitor list density once option counts become high across categories | P2 |
| `app/routes/products._index.tsx` | Product list (split baseline) | ALIGNED | REMIT | final fit pass now keeps filter drawers mobile-safe with stacked summary labels and clearer results framing while preserving existing filter/action behavior, shared SoT dropdown controls, and typed fetcher/date handling | the full filter surface is dense by nature; keep summary labels short if more filter dimensions are added | P2 |
| `app/routes/products.new.tsx` | Product create (active) | ALIGNED | REMIT | create route now uses the compact SoT non-dashboard header shell with the shared upsert form and clearer route framing while keeping current product-create behavior | no major drift; monitor dense form fit through the shared form component as fields evolve | P2 |
| `app/routes/products.$productId.tsx` | Product detail (active) | ALIGNED | REMIT | detail page now keeps catalog summary first, demotes operations to a quieter end-of-page lane, and preserves the isolated destructive/open-pack controls without changing behavior | no major drift; keep photo/tag density compact on smaller screens | P2 |
| `app/routes/products.$productId.edit.tsx` | Product edit (active) | ALIGNED | REMIT | edit route now uses a calmer header/action hierarchy around the shared upsert form without changing the update workflow | no major drift; keep shared form helper text concise as fields expand | P2 |
| `app/routes/creation.riders.tsx` | Admin rider creation | ALIGNED | REMIT | rider directory now uses a quieter toolbar summary, more stable create/edit form collapse, and calmer row/action density while preserving shared SoT controls and typed loader/action handling | no major drift; keep default-vehicle metadata compact as fleet options grow | P2 |
| `app/routes/creation.vehicles.tsx` | Admin vehicle creation | ALIGNED | REMIT | province-style SoT pattern is applied (search/status toolbar, focused create/edit panels, paged table, consistent row actions), and vehicle loader/action typing now avoids route-level `any` bypass in filter and error paths | monitor if advanced filters are needed as fleet volume grows | P2 |
| `app/routes/creation.provinces.tsx` | Admin province creation | ALIGNED | REMIT | province directory now uses a quieter toolbar summary, steadier create/edit form collapse, and more stable row/action alignment while preserving typed filter and error handling | no major drift; keep row height stable if more province metadata is introduced later | P2 |
| `app/routes/creation.areas.tsx` | Admin area hierarchy creation | ALIGNED | REMIT | compact hierarchy UX is applied with sticky navigator, single active workspace tab, shared SoT dropdown controls, and internal scroll tables while preserving strict parent-child validation; action error handling now avoids route-level `any` bypass | consider server-side pagination if area records become very large | P2 |
| `app/routes/creation.opening-ar-batches.tsx` | Opening balance batch encode | ALIGNED | N/A | batch encode lane now uses shorter staging guidance, calmer composer copy, and tighter submit feedback while preserving typed batch grouping and case/claim create payload writes | monitor row-composer density if large itemized batches become common | P2 |
| `app/routes/cashier._index.tsx` | Cashier dashboard | ALIGNED | REMIT | focus-state layout now anchors the page on shift console, reduces per-link instruction tails, and moves payroll/schedule content into quieter reference panels while keeping typed charge and shift aggregation intact | shift-first hierarchy is clear; monitor future reference density as payroll metadata grows | P2 |
| `app/routes/login.tsx` | Public auth entry | ALIGNED | N/A | sign-in surface now keeps dev seed credentials behind a local-only disclosure while preserving the current auth and OTP flow | keep helper content local/dev only | P3 |
| `app/routes/cashier.pos._index.tsx` | Cashier queue (walk-in) | ALIGNED | REMIT | pickup queue copy now uses shorter entry labels and calmer action rhythm while preserving queue action typing, lock behavior, and route-local confirmation flows | keep pickup-code and queue actions concise as more queue states are added | P2 |
| `app/routes/orders.new.tsx` | Order creation action (PAD submit) | ALIGNED | N/A | server-side order create payload handling now avoids route-level `any` bypass with typed incoming item validation and enum-safe order/channel writes | monitor payload-contract docs if client fields evolve | P2 |
| `app/routes/pad-order._index.tsx` | Order pad workspace | ALIGNED | N/A | final SoT spacing/color parity pass applied across shell width, card rhythm, accent states, and cart/product controls while preserving existing cart/create behavior and typed client guards | keep scanner and quantity-control density monitored as product volume grows | P2 |
| `app/routes/cashier.$id.tsx` | Cashier settlement (walk-in) | ALIGNED | REMIT | settlement view now compresses payment-side helper copy, shortens clearance wording, and keeps frozen-pricing plus release-with-balance guidance clearer on small screens while preserving typed clearance snapshot parsing and lock/decision guard handling | keep payment helper text and button titles short as clearance rules evolve | P2 |
| `app/routes/rider._index.tsx` | Rider dashboard | ALIGNED | CHECKIN | task-board layout now puts do-now work and my-runs access first, removes noisy instructional CTA tails, and demotes seller help into secondary actions/reference while keeping typed rider gating and payroll/charge aggregation intact | rider priorities are clearer; keep secondary process notes short and non-blocking | P2 |
| `app/routes/store.dispatch.tsx` | Dispatch queue | ALIGNED | REMIT | operational inbox pilot now uses a compact triage strip, a calmer filter/bulk-action shell, and denser dispatch rows with clearer failed-delivery review actions while preserving typed dispatch assignment logic | keep exception rows compact as failed-delivery evidence grows | P2 |
| `app/routes/runs._index.tsx` | Runs index | ALIGNED | REMIT | runs list now shows clearer next-step labels, calmer header framing, tighter row rhythm, and an operational-list route-transition skeleton while preserving typed run status/filter handling | keep next-step labels synced with future run states | P2 |
| `app/routes/runs.new.tsx` | Run create form | ALIGNED | REMIT | run-create form now aligns select shell tokens with other manager forms and uses tighter create-to-staging framing without changing create behavior | keep the create form compact if more fields are added later | P2 |
| `app/routes/runs.$id.dispatch.tsx` | Run staging | ALIGNED | REMIT | staging now uses shorter linked-order/loadout guidance and clearer save-dispatch framing while preserving typed loadout handling and fulfillment-status fallback logic | keep shortage messaging concise if more stock evidence is added later | P2 |
| `app/routes/runs.$id.summary.tsx` | Run summary | ALIGNED | REMIT | SoT non-dashboard header + alerts + status badges + stock table primitives are applied, and summary loader parsing now avoids route-level `any` bypass (`riderCheckinSnapshot`, `loadoutSnapshot`, clearance case mapping) | keep recap helper copy concise as totals evolve | P2 |
| `app/routes/runs.$id.rider-checkin.tsx` | Rider check-in + CSS | ALIGNED | CHECKIN | SoT non-dashboard header + action-area loading states are applied, and rider-checkin loader/action payload handling now avoids route-level `any` bypass for snapshot/case parsing and submit-clearance guards | loading and lock states are clearer; reduce repeated hints in dense rows | P2 |
| `app/routes/store.clearance.tsx` | Clearance inbox | ALIGNED | CHECKIN | SoT non-dashboard header + card/table/status badge patterns are applied, clearance inbox loader typing avoids route-level `any` bypass for case-status filtering and walk-in/delivery mapping, and the opening-batch route is now surfaced as a clearer linked lane inside the clearance hub | keep tab-filter clarity and linked-lane density compact on smaller screens | P3 |
| `app/routes/store.clearance_.$caseId.tsx` | Clearance decision | ALIGNED | CHECKIN | SoT non-dashboard header applied, and decision loader/action typing now avoids route-level `any` bypass in label parsing and write paths | none significant | P3 |
| `app/routes/store.clearance-opening-batches.tsx` | Opening balance clearance batch lane | ALIGNED | CHECKIN | opening-batch review now uses clearer batch actions, shorter exception guidance, and stacked due/ref metadata for tighter compact/mobile fit while preserving enum-safe decision/case status writes | keep batch-row notes short if more reference fields appear later | P2 |
| `app/routes/runs.$id.remit.tsx` | Manager remit | ALIGNED | REMIT | SoT non-dashboard header + cards/alerts/buttons + stock table primitives are applied, and remit loader/action typing now avoids route-level `any` bypass on clearance status handling | no major drift; continue trimming dense per-line helper text | P3 |
| `app/routes/cashier.delivery._index.tsx` | Cashier run list | ALIGNED | REMIT | cashier remit list now uses tighter remit phrasing, calmer lock-state summaries, and more direct open-remit actions while preserving typed run-order cash-map parsing and lock checks | keep row-state labels short if more remit metadata is added | P2 |
| `app/routes/cashier.delivery.$runId.tsx` | Cashier remit hub | ALIGNED | REMIT | SoT non-dashboard header + cards/alerts/status badges + remit table primitives are applied, and remit loader/action typing now runs without route-level `any` bypass | row-level helper text can still be trimmed | P2 |
| `app/routes/delivery-remit.$id.tsx` | Cashier order remit | ALIGNED | REMIT | SoT non-dashboard header applied; remit loader/action now use typed frozen-line + enum-safe settlement paths without route-level `any` bypass | none significant | P3 |
| `app/routes/ar._index.tsx` | AR index | ALIGNED | REMIT | operational inbox pass now adds a compact triage strip, tighter search shell, and a clearer receivable table hierarchy while preserving typed A/R grouping logic | keep past-due emphasis compact if ledger metadata expands | P2 |
| `app/routes/ar.customers.$id.tsx` | AR ledger | ALIGNED | REMIT | SoT non-dashboard header + alert/card/form/table/status badge primitives are applied, and payment-post action typing now avoids route-level `any` bypass with enum-safe A/R status updates | keep receipt/proof helper text concise in activity rows | P2 |
| `app/routes/cashier.shift.tsx` | Cashier shift console | ALIGNED | REMIT | console/workspace pass now leads with a compact current-state strip, foregrounds opening/count actions as the workbench, and demotes totals/history into quieter reference blocks while preserving typed shift transaction and submit logic | denomination editing remains intentionally dense inside the workbench; keep helper copy short as close rules evolve | P2 |
| `app/routes/cashier.shift-history.tsx` | Cashier shift history | ALIGNED | REMIT | history view now uses a more compact filter grid and shorter status-drawer labels for better table fit while preserving typed status filters and cash-count parsing | keep drawer metadata compressed as more audit fields accumulate | P2 |
| `app/routes/store.cashier-shifts.tsx` | Shift manager panel | ALIGNED | REMIT | console/workspace pass now gives manager shifts a compact state strip, a smaller open-shift setup panel, and clearer resend/final-close workbenches while preserving typed shift resend, variance-print, and final-close logic | keep row summaries compact if more audit metadata gets added later | P2 |
| `app/routes/store.cashier-variances.tsx` | Cashier variance decision | ALIGNED | REMIT | variance review now uses shorter queue framing and simpler evidence disclosure labels while preserving typed variance filters and denomination snapshots | keep evidence notes concise as close-audit detail expands | P2 |
| `app/routes/cashier.charges.tsx` | Cashier charge acknowledgment | ALIGNED | REMIT | charge acknowledgment now uses a clearer two-lane details area for note updates and close actions while keeping enum-safe variance filter/status writes and typed denomination parsing intact | keep details panels compact if more close fields are added | P2 |
| `app/routes/store.cashier-ar.tsx` | Cashier AR tagging | ALIGNED | REMIT | cashier AR tagging now uses shorter payroll-plan framing and calmer action labels while preserving typed cashier identity mapping | keep plan-note copy short if more collection-plan variants are introduced | P2 |
| `app/routes/store.payroll.tsx` | Payroll settlement | ALIGNED | REMIT | payroll workbench now uses tighter blocker and cutoff copy plus responsive summary grids while keeping enum-safe charge/variance status updates intact | employee detail panels remain dense by domain; keep helper copy minimal | P2 |
| `app/routes/store.rider-variances.tsx` | Rider variance manager review | ALIGNED | REMIT | rider variance review now uses shorter decision/action wording and calmer awaiting-review framing while preserving enum-safe tab filters, decision transitions, and typed manager actor mapping | keep decision notes and receipt metadata concise | P2 |
| `app/routes/rider.variances.tsx` | Rider pending acceptance list | ALIGNED | CHECKIN | rider pending list now uses shorter shortage phrasing and clearer review CTA labeling while keeping typed session actor and enum-safe variance filters intact | keep note lines compact on smaller screens | P2 |
| `app/routes/rider.variance.$id.tsx` | Rider variance acceptance detail | ALIGNED | CHECKIN | variance detail now uses shorter action-evidence copy and calmer rider-action wording while preserving typed rider actor mapping and enum-safe acceptance transitions | keep the evidence block concise as audit fields expand | P2 |
| `app/routes/store.rider-charges.tsx` | Rider charge tracking/tagging | ALIGNED | REMIT | rider charge tagging now uses shorter payroll-plan framing and calmer action labels while preserving current charge-tagging behavior | keep plan-note copy short if more collection-plan variants are introduced | P2 |

## 4. Noise Hotspots and Family Focus (Observed)

Current revamp focus is grouped by route family instead of isolated page polish:

1. `Operational List / Inbox`
   `app/routes/store.dispatch.tsx`
   `app/routes/runs._index.tsx`
   `app/routes/ar._index.tsx`
   `app/routes/cashier.delivery._index.tsx`
   Focus: reduce filter/tool-bar noise, tighten table-first hierarchy, and keep triage visible before secondary metadata.
2. `Console / Workspace`
   `app/routes/cashier.shift.tsx`
   `app/routes/store.cashier-shifts.tsx`
   `app/routes/store.payroll.tsx`
   Focus: keep one dominant work area, compress repeated state summaries, and keep exceptions close to the active workbench.
3. `Decision / Detail`
   `app/routes/runs.$id.dispatch.tsx`
   `app/routes/store.clearance-opening-batches.tsx`
   `app/routes/rider.variance.$id.tsx`
   Focus: put summary and action areas ahead of dense evidence, and trim repeated guidance around approval/acceptance flows.
4. `Admin Form / Library`
   `app/routes/products._index.tsx`
   `app/routes/products.new.tsx`
   `app/routes/creation.riders.tsx`
   `app/routes/creation.provinces.tsx`
   Focus: improve responsive fit, reduce dense helper text, and keep forms/tables more dominant than support copy.

Target: remove repeated operational facts first, then improve layout fit and density before adding more UI surfaces.

## 5. Route Family Rollout Waves

1. Wave 0 (Current): dashboard baseline + SoT extension.
2. Wave 1: `Operational List / Inbox` pilots
   `app/routes/store.dispatch.tsx`
   `app/routes/ar._index.tsx`
   `app/routes/runs._index.tsx`
   `app/routes/cashier.delivery._index.tsx`
3. Wave 2: `Console / Workspace`
   `app/routes/cashier.shift.tsx`
   `app/routes/store.cashier-shifts.tsx`
   `app/routes/store.payroll.tsx`
4. Wave 3: `Decision / Detail` and other heavy-noise review routes
   `app/routes/runs.$id.dispatch.tsx`
   `app/routes/store.clearance-opening-batches.tsx`
   `app/routes/store.cashier-ar.tsx`
   `app/routes/store.cashier-variances.tsx`
   `app/routes/cashier.charges.tsx`
   `app/routes/store.rider-variances.tsx`
   `app/routes/rider.variances.tsx`
   `app/routes/rider.variance.$id.tsx`
   `app/routes/store.rider-charges.tsx`
5. Wave 4: `Admin Form / Library` partials
   `app/routes/products._index.tsx`
   `app/routes/products.new.tsx`
   `app/routes/products.$productId.tsx`
   `app/routes/products.$productId.edit.tsx`
   `app/routes/creation.riders.tsx`
   `app/routes/creation.provinces.tsx`
6. Wave 5: final responsive-fit, copy-compression, and conformance refresh pass.

## 6. UX Gap Checklist (Per Route Update)

When a route is modified, verify:

1. shell matches the active family contract (`Dashboard`, `Operational List / Inbox`, `Console / Workspace`, `Decision / Detail`, `Admin Form / Library`, or `Public / Auth`).
2. status is readable before explanatory copy.
3. locked/disabled/pending states are explicit.
4. helper text stays within noise budget and is not repeated across adjacent sections.
5. desktop and mobile layout keep the primary action visible.
6. badges, chips, and secondary metadata do not crush the main text at common desktop widths.

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
