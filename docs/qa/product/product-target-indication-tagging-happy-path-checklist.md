# Product Target Indication Tagging Happy Path Checklist

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

Verify that an admin can tag one seeded indication and one seeded target through the real product edit form and land on product detail with both chips visible.

## Setup

1. Run `npm run qa:product:target-indication-tagging:happy-path:setup`.
2. Copy the printed edit route, detail route, tagged product name, image tag marker, category, indication, and target from the console output.
3. Do not reuse the printed image tag marker for non-QA product work.

## Browser QA Steps

1. Run `npm run ui:test:product:target-indication-tagging:happy-path`.
2. The browser scenario stops after the detail route and DB join rows are re-verified.

## Manual QA Steps

1. Log in as `ADMIN`.
2. Open the printed `/products/:id/edit` route.
3. In `Indications`, select the printed indication.
4. In `Targets`, select the printed target.
5. Click `Update Product`.
6. Confirm the browser lands on the printed `/products/:id` detail route.
7. Confirm the printed indication chip appears under `Indications`.
8. Confirm the printed target chip appears under `Targets`.

## Expected Outcomes

1. the tagged product saves successfully from the real edit form with one seeded indication and one seeded target
2. the browser redirects to product detail after save
3. exactly one `ProductIndication` row is stored for the selected indication
4. exactly one `ProductTarget` row is stored for the selected target
5. unrelated product fields like pricing, stock, active state, and photo slots remain unchanged

## Cleanup

1. Run `npm run qa:product:target-indication-tagging:happy-path:cleanup`.
2. If cleanup reports deleted rows, confirm only the printed tagged product was targeted.
