# Documentation Index

This repository uses a tiered documentation model so engineers can quickly find what is binding versus historical.

## 1) Governance (Highest Priority)

1. `docs/Chat Operating Rules/Chat Execution Rules.md`
2. `docs/Governance SOP/AI Governance SOP.md`
3. `docs/guide/Commercial Clearance System V2`

If guidance conflicts, follow the order above.

## 2) Domain Canonical (Binding for Product Behavior)

Start here for Order Pricing + Delivery + Clearance + Cashier + AR behavior:

1. `docs/guide/README.md`
2. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
3. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
4. `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md`
5. `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`
6. `docs/guide/Commercial Clearance System V2`
7. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
8. `docs/guide/RunReceipt_Architecture.md`

## 3) Archive and Superseded Notes

Use `docs/archive/README.md` for deprecation and migration notes.
Do not use archived documents as implementation authority.

## 4) Authoring Rules (Required)

Every new or updated domain document must include:

- `Status:` (`LOCKED`, `ACTIVE`, `DEPRECATED`, `ARCHIVED`)
- `Owner:` (team/role)
- `Last Reviewed:` (YYYY-MM-DD)
- `Supersedes:` (optional)
- `Superseded By:` (optional)
- If behavior/flow changed in code, update the impacted canonical flow and diagram docs in the same objective/PR.

## 5) Fast Path

For delivery-commercial bugs, read in this order:

1. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md`
4. `docs/guide/Commercial Clearance System V2`
5. `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`
6. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
