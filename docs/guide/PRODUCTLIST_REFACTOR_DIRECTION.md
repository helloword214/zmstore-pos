# Product List Refactor Direction (Draft)

Status: DRAFT (Discussion Working Doc)  
Owner: POS Platform  
Last Reviewed: 2026-03-08

## Purpose

Capture the agreed refactor direction for product-list behavior so planning remains consistent across sessions.

This doc is directional (target-state planning), not a replacement for current canonical behavior docs.

## Current Pain Points

1. `products._index.tsx` is monolithic (list + create/edit workflows + related behaviors in one route).
2. Product list and product creation live in the same route/UI surface, making maintenance and testing harder.
3. There is no stable product detail route per item for deep-linking and future view workflows.
4. Category acts as the mother classification for product options, and lifecycle management is now first-class in admin option flows (create/edit/archive with archive-only policy).

## Direction Summary

1. Keep product model flexible for mixed catalog types (retail-capable, whole-only, returnable-container).
2. Replace LPG-only special thinking with a generic container-return pattern.
3. Preserve current order stock contract (`PACK` vs `RETAIL`) while extending behavior in a controlled way.
4. Keep retail price floor checks non-blocking (`warning-only`) unless business policy changes.
5. Prioritize fast implementation now, with scale hooks kept for future phases.

## Deployment Assumption (Fast Path)

1. Near-term setup is single-store per deployment (one branch/store setup at a time).
2. Another store uses another deployment setup (separate app+DB environment).
3. Multi-tenant shared deployment is deferred (future scale phase), not a blocker for current refactor.

## Confirmed Constraints From Current Discussion

1. Retail fractions stay fixed to `.25`, `.50`, `.75`, `1.00`.
2. `open-pack` stays manual-only.
3. Retail price can be auto-computed from whole price (`srp / packingSize`) but admin override is allowed.
4. Catalog includes products that cannot be retailed (whole-only items such as cage/accessories).
5. Unit/content representation must support examples like:
   - rice: sack content in `kg`
   - shampoo: bottle content in `ml`
   - cage/accessory: whole-only `pc`/`unit`
   - LPG: cylinder container with content measured in `kg`

## Route Architecture Direction (Target)

Split responsibilities into focused routes:

1. `products._index.tsx` -> list/filter/table only
2. `products.new.tsx` -> creation form + creation validations
3. `products.$productId.tsx` -> product detail/read-only view (future deep-link entry)
4. `products.$productId.edit.tsx` -> edit/update workflow
5. supporting endpoints stay as resource/api routes as needed

Design goal: each route has one primary responsibility and can evolve independently.

## UI Revamp Governance Alignment

1. Product module UI may be fully redesigned and old productlist components may be retired.
2. Visual consistency must still follow SoT UI tokens/components (`UI_SOT.md`).
3. Conformance tracking for product routes must stay updated in `ui/UI_CONFORMANCE_MATRIX.md`.
4. UI revamp is implementation-flexible, behavior-rigid (no silent business-rule drift).

## Category Management Direction (Target)

1. Category should be admin-managed master data (dynamic, DB-backed), not operationally fixed.
2. In each store deployment, admin can create/edit/archive category list used by product encoding.
3. `Brand`, `Indication`, and `Target` remain category-scoped children.
4. Deletion/archival policy must protect referential integrity when products already use the category.

## Product Detail Route Direction

1. Every product gets stable URL: `/products/:productId`.
2. List rows can deep-link to detail route.
3. Detail page becomes the anchor for future expansions:
   - stock timeline
   - pricing history/audit
   - container-return ledger view
   - expiration batch/lot presentation (if introduced)

## Proposed Generic Product Behavior Profiles (Target)

1. `WHOLE_ONLY`
   - Sold only as container/whole unit.
   - Examples: cage, many accessories, some equipment.
2. `WHOLE_AND_RETAIL`
   - Can sell both pack and fractional/base-unit.
   - Examples: rice/grains, selected feeds.
3. `RETURNABLE_CONTAINER`
   - Sale can include container exchange/loan/return logic.
   - Examples: LPG cylinder, water gallon, returnable bottles/crates.

Note: profile naming is planning-only for now. Schema/API names to be finalized during implementation phase.

## Generic Returnable-Container Pattern (Target Concept)

Model the behavior as container transactions, not LPG-only fields:

1. Filled content sold (`contentQty` in base unit).
2. Empty container returned (`emptyReturnedQty`).
3. Container loaned when no empty returned (`containerLoanQty`).
4. Optional container deposit/charge policy (`containerCharge`/`deposit` rules).
5. Customer-level outstanding container balance ledger (generic, not fuel-specific).

## Migration Intention (From Current LPG Hooks)

Planning mapping for future implementation:

1. `OrderItem.isLpg` -> product/profile or transaction classification (generic)
2. `OrderItem.lpgSwapKind` -> generic container transaction kind
3. `OrderItem.lpgEmptyReturned` -> `emptyReturnedQty`
4. `OrderItem.lpgLoaned` -> `containerLoanQty`
5. `CylinderLoan` -> generic customer container-loan ledger

## Expiration Applicability Direction

`expirationDate` exists but should remain context-based, not globally required.

Suggested applicability matrix:

1. Consumables with shelf life (food/feed/medicine): recommended/trackable
2. Consumables without strict date in ops flow: optional
3. Non-consumables/accessories/equipment: not required by default
4. Returnable containers (cylinder/crate/gallon shell): usually not expiration-driven

## Phased Rollout Plan (No-Code to Code)

### Phase 0: Planning Freeze (Current)

1. Lock discussion decisions in docs.
2. Finalize terminology for profiles and container transaction fields.
3. Keep canonical as-is docs unchanged except explicit clarifications already approved.

### Phase 1: Route Split (Behavior-Parity Refactor)

1. Split `products._index.tsx` into list/new/detail/edit routes.
2. Keep business behavior parity:
   - retail fractions `.25/.50/.75/1.00`
   - manual-only `open-pack`
   - warning-only retail floor checks
3. Add per-product deep links from list.

### Phase 2: Category Master Upgrade

1. Add category create/edit/archive in admin option management.
2. Enforce dependency guards before destructive operations.
3. Align product creation/edit forms to new category master flows.
4. Status update (2026-03-08): implemented on `creation._index.tsx` + category resource endpoints with archive-only lifecycle and product-form/action guard alignment.

### Phase 3: Generic Returnable-Container Model

1. Design generic container transaction lifecycle (exchange/loan/return/deposit).
2. Migrate LPG-specialized semantics into generic model.
3. Roll out per-category/product profile enablement.

### Phase 4: Scale Readiness (Deferred)

1. Evaluate tenant/store scoping strategy for shared deployment.
2. Introduce tenant boundaries only when business requires multi-client single deployment.

## Phase Summary (Goals + Non-Goals)

### Phase 1

1. Goal: split monolith route into list/new/detail/edit with behavior parity.
2. Non-goal: changing pricing/stock business rules.

### Phase 2

1. Goal: make category master operationally dynamic for each store deployment.
2. Non-goal: multi-tenant shared deployment redesign.

### Phase 3

1. Goal: replace LPG-specialized semantics with generic returnable-container model.
2. Non-goal: full inventory architecture rewrite outside container lifecycle scope.

### Phase 4

1. Goal: prepare and execute scale strategy when needed (tenant/store boundaries).
2. Non-goal: forcing tenant complexity before business requirement exists.

## Refactor Guardrails

1. Do not break existing `PACK`/`RETAIL` stock deduction contract.
2. Do not couple generic returnable flow to one category label (`LPG`) only.
3. Preserve manual operator control where currently manual (`open-pack`, price override).
4. Keep docs updated together with behavior changes in the same objective.
5. Favor smallest safe increments over one-shot broad rewrite.
6. Ensure every phase leaves a stable and testable state.

## Linked Canonical Sources

1. `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md` (as-is behavior)
2. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md` (pricing authority)
