# Product List Refactor Roadmap Checklist

Status: DRAFT (Execution Checklist)  
Owner: POS Platform  
Last Reviewed: 2026-02-28

Legend:

1. `[TODO]` not started
2. `[IN_PROGRESS]` active
3. `[DONE]` completed and validated

## Phase 1 — Behavior-Parity Route Split

Objective: split product monolith route into focused routes without changing business behavior.

Checklist:

1. `[TODO]` Freeze parity baseline from canonical docs.
2. `[TODO]` Define route ownership map:
   - `products._index.tsx` (list)
   - `products.new.tsx` (create)
   - `products.$productId.tsx` (detail)
   - `products.$productId.edit.tsx` (edit)
3. `[TODO]` Extract shared product form/validation helpers to avoid duplicated behavior.
4. `[TODO]` Keep pack/retail rules unchanged (`0.25` fractions, manual `open-pack`, warning-only floor).
5. `[TODO]` Add stable deep-link navigation from list rows to detail route.
6. `[TODO]` Preserve SKU/barcode current behavior:
   - SKU auto when blank, manual allowed
   - barcode optional
   - duplicate barcode -> regenerate/replace and retry save
7. `[TODO]` Mark legacy productlist UI components as deprecated once replacement is stable.
8. `[TODO]` Update UI conformance entries for touched product routes.

Acceptance criteria:

1. All current critical behaviors are parity-verified against canonical docs.
2. No new business-rule regressions in create/edit/order-facing product effects.
3. Product list has route-level deep link per item.

## Phase 2 — Category Master Upgrade

Objective: make category fully admin-managed dynamic master data per store deployment.

Checklist:

1. `[TODO]` Implement category create/edit/archive flows in admin options.
2. `[TODO]` Add dependency guards before destructive operations.
3. `[TODO]` Keep `Brand/Indication/Target` category-scoped integrity.
4. `[TODO]` Align product create/edit flows with updated category lifecycle.
5. `[TODO]` Document archive/delete policy and operator guidance.

Acceptance criteria:

1. Admin can manage category lifecycle without DB/manual intervention.
2. Category operations do not break product referential integrity.

## Phase 3 — Generic Returnable-Container Model

Objective: generalize LPG-specific container logic into reusable product behavior.

Checklist:

1. `[TODO]` Finalize generic container transaction vocabulary and schema targets.
2. `[TODO]` Map current LPG hooks to generic model.
3. `[TODO]` Implement container return/loan transaction flow for applicable products.
4. `[TODO]` Add customer-level container balance tracking.
5. `[TODO]` Validate with at least LPG + one non-LPG returnable example.

Acceptance criteria:

1. Returnable-container behavior is not LPG-only.
2. Existing non-returnable product flows remain unaffected.

## Phase 4 — Scale Readiness (Deferred)

Objective: prepare multi-client scaling only when business requires it.

Checklist:

1. `[TODO]` Decide tenant/store boundary strategy and migration path.
2. `[TODO]` Design tenant-scoped master data model (categories/options/products).
3. `[TODO]` Define rollout plan from single-store deployments to shared model.
4. `[TODO]` Define isolation, migration, and operational support rules.

Acceptance criteria:

1. Scale strategy is explicit, testable, and migration-safe.
2. No premature tenant complexity added before requirement trigger.

## Documentation Sync Checklist (All Phases)

1. `[TODO]` Keep `CANONICAL_PRODUCTLIST_SHAPE_SOT.md` aligned with actual behavior.
2. `[TODO]` Keep `PRODUCTLIST_REFACTOR_DIRECTION.md` aligned with approved target direction.
3. `[TODO]` Keep `PRODUCTLIST_REFACTOR_DECISION_LOG.md` updated for new decisions.
4. `[TODO]` Keep `ui/UI_SOT.md` and `ui/UI_CONFORMANCE_MATRIX.md` updated when UI flows change.
