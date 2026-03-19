# Product Catalog Admin Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This checklist is a secondary QA artifact.
It does not own product behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md`
3. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
4. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify the core admin product lifecycle: create, edit, deactivate, and reactivate a tagged product through the real product routes.

## Setup

1. Run `npm run qa:product:catalog-admin:happy-path:setup`.
2. Copy the printed category, unit, packing unit, tagged product names, and image tag marker from the console output.
3. Do not reuse the printed image tag marker for non-QA catalog work.

## Browser QA Steps

1. Run `npm run ui:test:product:catalog-admin:happy-path`.
2. The browser scenario stops after the tagged product is reactivated and re-verified.

## Manual QA Steps

1. Log in as `ADMIN`.
2. Open `/products/new`.
3. Create the tagged product using the printed category, unit, and packing unit.
4. Enable retail selling mode.
5. Fill the printed commercial fields and save the product.
6. Confirm the browser lands on the product detail route and the product starts as `Active`.
7. Open `/products` and confirm the tagged product appears in the list.
8. Open the tagged product edit route.
9. Update the printed fields and switch the product to inactive.
10. Save the edit and confirm detail now shows `Inactive`.
11. Open the edit route again, reactivate the product, and save.
12. Confirm detail now shows `Active` again.

## Expected Outcomes

1. admin can create the tagged product from `/products/new`
2. create lands on the product detail route
3. the tagged product appears in `/products`
4. edit updates the expected product fields
5. deactivate updates the product status to inactive
6. reactivate updates the product status back to active
7. no photo upload lane is required for this core scenario

## Cleanup

1. Run `npm run qa:product:catalog-admin:happy-path:cleanup`.
2. If cleanup reports deleted rows, confirm only the printed image tag marker was targeted.
