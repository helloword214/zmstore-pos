# Product Photo Upload Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-21

This checklist is a secondary QA artifact.
It does not own product behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md`
3. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
4. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify that an admin can upload tagged product photos through the real product edit form and land on product detail with the uploaded slot previews intact.

## Setup

1. Run `npm run qa:product:photo-upload:happy-path:setup`.
2. Copy the printed edit route, detail route, tagged product name, image tag marker, and runtime upload file paths from the console output.
3. Do not reuse the printed image tag marker for non-QA product work.

## Browser QA Steps

1. Run `npm run ui:test:product:photo-upload:happy-path`.
2. The browser scenario stops after the detail route and DB photo rows are re-verified.

## Manual QA Steps

1. Log in as `ADMIN`.
2. Open the printed `/products/:id/edit` route.
3. In `Product Photos (optional, max 4)`, upload the printed Slot 1 file to `Slot 1`.
4. Upload the printed Slot 3 file to `Slot 3`.
5. Click `Update Product`.
6. Confirm the browser lands on the printed `/products/:id` detail route.
7. Confirm the slot 1 and slot 3 photos are visible in `Photos (max 4)`.

## Expected Outcomes

1. the tagged product saves successfully from the real edit form with photo files attached
2. the browser redirects to product detail after save
3. exactly one photo row is stored for each uploaded slot
4. unrelated product fields like pricing, stock, category, brand, and active state remain unchanged
5. this first slice does not require photo replacement or invalid-file handling

## Cleanup

1. Run `npm run qa:product:photo-upload:happy-path:cleanup`.
2. If cleanup reports deleted rows or files, confirm only the printed tagged product and owned uploaded QA files were targeted.
