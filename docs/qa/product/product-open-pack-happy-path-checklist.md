# Product Open Pack Happy Path Checklist

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

Verify that an admin can open tagged whole stock into retail stock from the real product detail route without mutating unrelated product fields.

## Setup

1. Run `npm run qa:product:open-pack:happy-path:setup`.
2. Copy the printed detail route, tagged product name, image tag marker, pack count, and expected stock values from the console output.
3. Do not reuse the printed image tag marker for non-QA product work.

## Browser QA Steps

1. Run `npm run ui:test:product:open-pack:happy-path`.
2. The browser scenario stops after the tagged product detail snapshot and DB state are re-verified.

## Manual QA Steps

1. Log in as `ADMIN`.
2. Open the printed `/products/:id` detail route.
3. Confirm the tagged product shows the printed starting `Whole Stock` and `Retail Stock`.
4. Confirm `Open Pack` is available in the `Operations` section.
5. Trigger `Open Pack` and enter the printed pack count in the prompt.
6. Confirm the success alert `Stock opened to retail.`
7. Confirm the detail snapshot now shows the printed expected whole and retail stock values.

## Expected Outcomes

1. `Open Pack` is available for the tagged product because pack sale, stock, and packing size are all valid
2. opening packs updates the same product in place
3. `Whole Stock` decreases by the submitted pack count
4. `Retail Stock` increases by `packs * packingSize`
5. no unexpected pricing, category, brand, or active-state mutation occurs

## Cleanup

1. Run `npm run qa:product:open-pack:happy-path:cleanup`.
2. If cleanup reports deleted rows, confirm only the printed image tag marker was targeted.
