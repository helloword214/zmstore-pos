# Product List Refactor Decision Log

Status: DRAFT (Discussion Log)  
Owner: POS Platform  
Last Reviewed: 2026-03-08

## Purpose

Maintain a compact, session-resilient log of refactor decisions so implementation can start from explicit agreements, not memory.

## Confirmed Decisions (Agreed)

1. Product list refactor proceeds in phases; docs-first before code.
2. `products._index.tsx` should be split by responsibility (list/new/detail/edit route surfaces).
3. Product detail route is required for future deep-linking (`/products/:productId`).
4. Retail fraction behavior remains fixed to `.25`, `.50`, `.75`, `1.00`.
5. `open-pack` remains manual-only.
6. Retail price may be auto-computed from `srp / packingSize`, but admin override is allowed.
7. Retail floor guidance stays `warning-only` (non-blocking) at this stage.
8. Category is mother classification and should become admin-managed dynamic master data.
9. Near-term deployment direction is single-store per deployment (fast path).
10. LPG-specialized semantics should move toward a generic returnable-container model (not LPG-only).
11. Barcode is optional in product flow; when generated code conflicts, operator regenerates/enters another code (no hard-block policy change beyond unique enforcement).
12. Category lifecycle policy is archive-only (no hard delete); archived categories are hidden from default product/category choices while existing product links remain valid.
13. Full-repo `CHECK` currently has unrelated pre-existing lint/type debt; Phase 2 delivery used `FORCE-COMMIT` and cleanup is tracked as next-task backlog.

## Deferred Decisions (Not Blocking Phase 1)

1. Final schema names for generic container fields/entities.
2. Whether expiration should be mandatory by category/profile in later phases.
3. Exact UI placement and information architecture for category master management.

## Open Questions (Future Scale)

1. Multi-tenant strategy timeline (shared deployment with tenant isolation).
2. Tenant/store scoping keys and migration path from single-store deployments.
3. Cross-tenant template catalogs (if ever needed) vs fully isolated masters.

## Working Assumptions Until Changed

1. Behavior parity is mandatory during route split.
2. Existing pricing/stock contracts are source-compatible during structural refactor.
3. Docs in `docs/guide/` remain primary planning anchor before implementation.

## Related Docs

1. `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md`
2. `docs/guide/PRODUCTLIST_REFACTOR_DIRECTION.md`
3. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
