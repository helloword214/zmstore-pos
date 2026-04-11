# Canonical Delivery -> Cashier -> AR Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-03-27
Supersedes: `DELIVERY_RUN_CANONICAL_FLOW.md` (behavioral overlap)
Archived: `docs/archive/guide/DELIVERY_RUN_CANONICAL_FLOW.md`

## Purpose

Defines one end-to-end behavior for:

- order creation + pricing freeze
- dispatch
- rider check-in + CSS
- manager remit + stock audit
- cashier turnover audit
- cashier shift close + manager recount decision
- AR ledger entry authority

Visual map reference:

- `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`
- `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
- `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md`
- `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`

## Owns

This document owns:

1. end-to-end stage handoffs from order create through dispatch, rider check-in, clearance, remit, cashier turnover, and AR entry
2. route-stage responsibility map for this operational flow
3. cross-stage authority boundaries inside the delivery/cash/AR workflow
4. receipt/settlement flow rules that span more than one route family in this chain

## Does Not Own

This document does not own:

1. role/account authority model in general
2. cashier shift state machine and detailed recount close mechanics
3. file upload/storage contracts
4. pricing freeze algorithm details
5. product sell-shape and stock semantics
6. worker pay profile, payroll policy, or gross/net payroll computation

## Refer To

1. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for role authority and route access ownership
2. `CANONICAL_ORDER_PRICING_SOT.md` for pricing freeze and order creator audit anchors
3. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` for cashier shift close, manager recount, paper reference, and variance handling
4. `Accounts Receivable — Canonical Source of Truth (SoT)` for AR ledger and payment application rules
5. `CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md` for payroll policy, deduction timing, and payroll-run ownership
6. `DIAGRAMS_DELIVERY_CSS_AR.md` for visual flow and handoff mapping

## Core Rule Set

1. `PARTIALLY_PAID` is operational state only.
2. Customer AR authority is `customerAr` only.
3. `customerAr` rows are created only from manager-approved CSS decisions with `arBalance > 0`.
4. Rider shortage is rider-accountability flow; it must not create customer AR by itself.
5. Parent order pricing authority is frozen `OrderItem` snapshot created at `/orders/new`; settlement override discount is a separate CSS decision artifact.

## Role Authority Boundary (Binding)

1. `STORE_MANAGER` is the only role allowed to perform manager-stage actions in this flow.
2. `ADMIN` is creation/control-plane only and is not allowed in manager operational/commercial routes in this flow, including read-only access.
3. `CASHIER` and `EMPLOYEE` are execution lanes only (cash posting/encoding/acknowledgement), never commercial decision authority.

## Security Access Hardening Addendum (Approved 2026-03-12)

This addendum is binding target behavior for the next security patch objective.

Route access targets:

1. `/pad-order`, `/orders/new`:
   - allowed: `CASHIER`, `STORE_MANAGER`, `EMPLOYEE`
   - denied: `ADMIN`
   - never public
2. `/orders/:id/slip`, `/orders/:id/ticket`, `/orders/:id/receipt`:
   - allowed: `CASHIER`, `STORE_MANAGER`, `EMPLOYEE`
   - denied: `ADMIN`
   - never public
3. Retired legacy routes `/orders/:id/ack` and `/orders/:id/credit` must not be reintroduced.

Release-with-balance approval policy:

1. Approval authority is server-verified `STORE_MANAGER` PIN.
2. Free-text approver input is not authority.
3. Approval writes must include audit anchors (`approvedByUserId`, `approvedAt`, actor snapshot).

Security backlog (same objective family, separate implementation tasks):

1. Add CSRF/origin checks on mutating endpoints in this flow.
2. Add response security headers policy (CSP, frame, content-type, referrer, HSTS in production).
3. Run dependency remediation wave for critical/high advisories before merge-ready hardening sign-off.

## Authoritative Route Map

This map is the primary route-level reference for canonical target behavior.

| Stage | Role | Route file | Primary responsibility | SoT focus |
| --- | --- | --- | --- | --- |
| Order Pad | Cashier/Manager/Employee | `app/routes/pad-order._index.tsx` | Build cart, capture customer/channel, submit order create request | Client preflight only, no pricing authority |
| Order create + pricing freeze | Server action | `app/routes/orders.new.tsx` | Validate payload, apply customer policy discount engine, freeze pricing snapshots | `order` + `orderItem` pricing freeze authority + creator audit (`createdById`, `createdByRole`) |
| Walk-in cashier queue | Cashier | `app/routes/cashier.pos._index.tsx` | List unpaid pickup/walk-in slips, open settlement, and delete accidental unpaid slips only | No paid void, refund, return, or cancellation authority |
| Dispatch queue | Manager | `app/routes/store.dispatch.tsx` | Select delivery orders, review failed-delivery returns, start a manual run via `/runs/new`, or create a new planned run from selected queue orders | Order eligibility plus failed-delivery redispatch/cancel authority; no AR authority |
| Run staging | Manager | `app/routes/runs.$id.dispatch.tsx` | Assign rider/vehicle/loadout, inspect item-level stock blockers, release linked parent orders before dispatch, and dispatch run | `deliveryRun`, `deliveryRunOrder`, `runReceipt` bootstrap |
| Runs inbox | Manager/Rider | `app/routes/runs._index.tsx` | Open actionable runs by default and switch to optional terminal history when recap/audit is needed; run creation starts in the dispatch queue, not this inbox | Operational run-state visibility only; cashier turnover for closed runs stays in `cashier.delivery._index.tsx` |
| Run summary | Manager/Rider | `app/routes/runs.$id.summary.tsx` | Read-only recap per run stage plus failed-delivery trace | `runReceipt`, `deliveryRunOrder.attemptOutcome`, `clearanceCase/decision`, recap services |
| Rider check-in | Rider | `app/routes/runs.$id.rider-checkin.tsx` | Encode receipt cash, report failed parent deliveries, and send clearance requests | `runReceipt`, `deliveryRunOrder.attemptOutcome` rider report, `clearanceCase(status=NEEDS_CLEARANCE)` |
| Clearance inbox | Manager | `app/routes/store.clearance.tsx` | View pending clearance workload | `clearanceCase` pending list |
| Clearance decision | Manager | `app/routes/store.clearance_.$caseId.tsx` | Approve/reject and classify decision | `clearanceDecision`, `customerAr` creation when `arBalance > 0` |
| Opening balance batch staging | Admin | `app/routes/creation.opening-ar-batches.tsx` | Encode/import pre-system open-balance rows into pending clearance | `clearanceCase(status=NEEDS_CLEARANCE)` creation only; no decision authority |
| Opening balance batch decision | Manager | `app/routes/store.clearance-opening-batches.tsx` | Bulk approve valid rows, reject exceptions | Per-row `clearanceDecision` + `customerAr` for approved rows |
| Manager remit | Manager | `app/routes/runs.$id.remit.tsx` | Stock audit and close run after rider check-in | Stock return/missing flow, failed-delivery stock verification, no direct AR authority |
| Cashier run list | Cashier | `app/routes/cashier.delivery._index.tsx` | Open closed runs for turnover remit | Run/order cash turnover visibility |
| Cashier run remit hub | Cashier | `app/routes/cashier.delivery.$runId.tsx` | Track turnover cash gap and finalize run settlement | `runReceipt.cashCollected` vs cashier cash payments |
| Cashier order remit | Cashier | `app/routes/delivery-remit.$id.tsx` | Post per-order cash turnover | `payment` + rider shortage bridge workflow |
| Shift console | Cashier | `app/routes/cashier.shift.tsx` | Opening verification, drawer txns, close count submit | `cashierShift` lifecycle and closing count snapshot |
| Shift manager panel | Manager | `app/routes/store.cashier-shifts.tsx` | Open shift, manager recount, decision capture, final close | Shift status authority + variance/charge write authority at close |
| Cashier variance review | Manager | `app/routes/store.cashier-variances.tsx` | Read-only variance queue/history | `cashierShiftVariance` audit visibility |
| Cashier charge acknowledgement | Cashier | `app/routes/cashier.charges.tsx` | Acknowledge manager-charged items | Charged variance visibility and acknowledgement trail |
| Cashier AR payroll tagging | Manager | `app/routes/store.cashier-ar.tsx` | Tag cashier charge items for payroll collection plan | Cashier charge collection planning |
| Payroll settlement | Manager | `app/routes/store.payroll.tsx` | Record payroll deductions against charge ledgers | Charge payment posting and variance status sync; full payroll computation belongs to `CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md` |
| AR customer list | Cashier | `app/routes/ar._index.tsx` | List customers with open approved balances | `customerAr` authority (target behavior) |
| AR customer ledger | Cashier | `app/routes/ar.customers.$id.tsx` | Post and review customer AR payments, show post-submit feedback, print receipt proof | `customerAr` ledger/payment application |

Runs inbox visibility rule:

1. `app/routes/runs._index.tsx` defaults to actionable run states only.
2. Manager inbox shows `PLANNED`, `DISPATCHED`, and `CHECKED_IN`.
3. Rider inbox shows assigned `DISPATCHED` and `CHECKED_IN` runs only.
4. Terminal run history (`CLOSED`, `CANCELLED`) is optional and must not crowd the default inbox.
5. Cashier closed-run turnover remains in `app/routes/cashier.delivery._index.tsx`.
6. `app/routes/runs.$id.summary.tsx` returns to the runs inbox (`/runs` for manager, `/runs?mine=1` for rider) instead of the dashboard.

Role label interpretation rule:

1. `Manager` in this table means `STORE_MANAGER` only (not `ADMIN`).

Clearance pending counter alignment rule:

1. Manager dashboard "Clearance pending decisions" count must use the same SoT as inbox list: `clearanceCase.status = NEEDS_CLEARANCE`.
2. Dashboard pending counter for `/store/clearance` includes only linked operational cases (`orderId` or `runReceiptId`).
3. Opening-balance pending rows are tracked and processed in `/store/clearance-opening-batches`, not in the main clearance pending counter.

## Legacy Route Retirement Addendum (Applied 2026-03-12)

The following legacy routes were removed because they were no longer part of canonical cashier/payment flow:

1. `app/routes/remit-summary.$id.tsx`
2. `app/routes/remit-receipt.$id.tsx`
3. `app/routes/receipts._index.tsx`
4. `app/routes/orders.$id.ack.tsx`
5. `app/routes/orders.$id.credit.tsx`

Canonical print/payment proof paths remain:

1. Walk-in and delivery cashier posting routes redirect to `app/routes/orders.$id.receipt.tsx`.
2. AR payment posting and 58mm proof printing remain in `app/routes/ar.customers.$id.tsx`.

This retirement does not change AR authority: `customerAr` remains decision-backed from manager-approved clearance outcomes only.

## Print Artifact Boundaries (Binding)

1. `orders.$id.slip.tsx` is the pickup order slip path (order-taking paper; not settlement proof).
2. `orders.$id.ticket.tsx` is the delivery ticket path (routing/address sheet; not settlement proof).
3. `orders.$id.receipt.tsx` is the settlement proof path for cashier posting outcomes.
4. `orders.new.tsx` selects initial print route by channel:
   - `PICKUP` -> `slip`
   - `DELIVERY` -> `ticket`
5. `pad-order._index.tsx` should keep this boundary visible in operator UX copy:
   - pickup lane: order slip
   - delivery lane: order ticket

## Paid Void, Refund, And Return Gap

1. Paid order voids, customer cash refunds, and product return intake are not owned by `cashier.pos._index.tsx`.
2. `cashier.pos._index.tsx` handles unpaid pickup/walk-in slips only and may delete accidental unpaid slips before settlement.
3. A future dedicated void/refund/return flow must preserve payment history, customer cash movement, stock return decisions, and audit approvals.

## Route SoT Guardrails

| Route file | Must never do |
| --- | --- |
| `app/routes/pad-order._index.tsx` | Finalize payable totals without `/orders/new` server validation/freeze |
| `app/routes/orders.new.tsx` | Reprice an already-created order or mix CSS override discount into policy discount freeze |
| `app/routes/cashier.pos._index.tsx` | Void/cancel paid orders, issue refunds, process returns, or delete anything except unpaid pickup/walk-in slips |
| `app/routes/runs.$id.rider-checkin.tsx` | Auto-approve AR/discount without manager decision or let the rider finalize re-dispatch/cancel for a failed parent delivery |
| `app/routes/creation.opening-ar-batches.tsx` | Create `customerAr` directly or issue manager decision outcomes |
| `app/routes/store.clearance-opening-batches.tsx` | Skip per-row decision artifacts when processing batch approvals |
| `app/routes/runs.$id.remit.tsx` | Infer customer AR from `PARTIALLY_PAID` alone |
| `app/routes/cashier.delivery.$runId.tsx` | Treat turnover shortage as automatic customer AR |
| `app/routes/delivery-remit.$id.tsx` | Recompute prices from product table for remit totals or open cashier remit for failed-delivery parent attempts |
| `app/routes/cashier.shift.tsx` | Re-open shift or keep drawer writable after count submit |
| `app/routes/store.cashier-shifts.tsx` | Final-close without submitted gate, manager recount, and shortage controls (decision + paper ref) |
| `app/routes/store.cashier-variances.tsx` | Accept decision writes; manager decisions are captured at final close in `store.cashier-shifts.tsx` |
| `app/routes/cashier.charges.tsx` | Allow non-owner cashier to acknowledge another cashier charge |
| `app/routes/ar._index.tsx` | Build AR list directly from open order status only |
| `app/routes/ar.customers.$id.tsx` | Create AR principal without decision-backed authority |

## Stage Flow

### T0 Order Creation (Pricing Freeze Gate)

- Cart is submitted from `pad-order._index.tsx` to `/orders/new`.
- Server validates stock/mode/base freshness and delivery constraints.
- Customer policy discounts (if customer rules exist) are applied once.
- Frozen snapshots (`unitKind`, `baseUnitPrice`, `discountAmount`, `lineTotal`) become downstream pricing authority.
- Creator audit is stamped at create time (`Order.createdById`, `Order.createdByRole`).

### T1 Dispatch (`PLANNED -> DISPATCHED`)

- Assign rider, vehicle, loadout.
- Run staging highlights the exact linked parent-order items whose current run draft exceeds live stock so the manager can rebalance loadout or release the affected order before dispatch.
- While the run is still `PLANNED`, manager may release a linked parent order back to the dispatch queue.
- Pre-dispatch release clears only the active `deliveryRunOrder` link for that order.
- Pre-dispatch release must not mutate inventory, cashier remit, or rider check-in artifacts.
- Physical run load is the sum of:
  - linked parent-order quantities
  - extra run load captured in `deliveryRun.loadoutSnapshot`
- A delivery parent order may accumulate many historical run attempts over time, but only one active run assignment is valid at once.
- Active run assignment means the order is linked to exactly one run in `PLANNED`, `DISPATCHED`, or `CHECKED_IN`.
- Reassignment must first release the order from its current active run; closed historical run links remain audit-only.
- `deliveryRun.loadoutSnapshot` stores extra-only load; parent-order reserved quantity is inferred from the linked delivery orders.
- Prepare run-linked receipt structures for PARENT orders.
- No AR creation here.

### T2 Rider Check-in (Commercial Gate)

Per receipt:

- Compute `remaining = frozenTotal - cashCollected`.
- If `remaining <= EPS`: settled by cash.
- If `remaining > EPS`: must create `ClearanceCase(status=NEEDS_CLEARANCE)`.

Per parent delivery order:

- Rider may report `failed delivery` only when goods were not released to the customer.
- Normal delivery is the default UI state; failed-delivery reporting is optional and collapses to one rider decision.
- Rider must capture the reason for the failed delivery attempt.
- Failed-delivery reporting is a logistics fact, not a commercial shortage outcome.
- Failed delivery must bypass clearance send logic for that parent order.
- Rider does not decide `re-dispatch` or `cancel`; that authority moves to the dispatch queue after remit.

Submit gate:

- Run cannot move to `CHECKED_IN` when any receipt is pending clearance or unresolved reject.
- Failed parent deliveries do not require clearance settlement, but they remain pending dispatch review after remit.

### T3 Manager Clearance (Commercial Authority)

Manager-only decision outcomes:

1. `APPROVE_OPEN_BALANCE`
2. `APPROVE_DISCOUNT_OVERRIDE`
3. `APPROVE_HYBRID`
4. `REJECT`

Decision effects:

- `approvedDiscount` and `arBalance` are derived from manager approval.
- If `arBalance > 0`, create `customerAr` entry.
- Reject requires full pay or VOIDED before settled state.

### T3b Opening Balance Batch Clearance (Pre-system Opening Balance Onboarding)

- Admin may stage/import opening balance rows only as pending clearance workload.
- Manager bulk lane processes those rows with default approve-valid behavior and explicit reject handling for exceptions/invalid rows.
- Every processed row still writes one `clearanceDecision`; approved rows with positive AR write `customerAr`.
- No admin action may create `customerAr` principal directly.

### T4 Manager Remit (Stock Audit, not AR Authority)

- Validate stock returns and missing stocks.
- If rider-reported failed-delivery stock is physically present, the run may close without waiting for the next logistics decision.
- Failed-delivery parent orders return to dispatch review by clearing dispatch state and keeping the order commercially open.
- Missing stock may trigger rider charge/variance path.
- Remit does not decide `re-dispatch` or `cancel`; it only verifies stock and closes the run.
- Close run to `CLOSED` only after checks pass.

### T4b Dispatch Review (Manager Logistics Authority)

- Dispatch queue receives failed-delivery parent orders after remit closes the run.
- Manager reviews attempt count plus rider reason.
- Manager decides either:
  - `re-dispatch` by assigning the order to a new planned run
  - `cancel` when the order should leave the delivery pipeline
- Partially paid parent orders still need refund/void handling before cancellation.

### T5 Cashier Delivery Remit (Money Turnover Audit)

- Compare rider-collected cash SoT vs cashier-recorded cash.
- Handle turnover shortage using rider-shortage workflow.
- Failed-delivery parent attempts are excluded from cashier turnover remit because no rider cash should exist for that run attempt.
- This flow addresses rider accountability, not customer AR authority.

### T6 AR Module (Customer Ledger)

AR list and customer ledger show balances from `customerAr` open balances only.

- Do not include orders in AR merely because status is `UNPAID`/`PARTIALLY_PAID`.
- Do not infer AR from payment gaps without approved CSS decision.
- On successful payment post, UI must show explicit confirmation (paid/applied/change/reference/payment IDs) and support 58mm receipt printing from the same page.

### T7 Cashier Shift Close (Cashier Submit + Manager Recount Final Close)

- Cashier records denomination-based physical count and submits close count.
- Submission changes shift to `SUBMITTED` and locks cashier drawer writes.
- Manager final close is executed in `store.cashier-shifts.tsx` with required manager recount total.
- If shortage is detected on manager recount, final close requires decision and paper reference number.

### T8 Cashier Variance and Charge Handling

- Variance decision is captured during manager final close in `store.cashier-shifts.tsx`.
- Mismatch upserts `cashierShiftVariance` (authoritative row by `shiftId`).
- Only short variance with `CHARGE_CASHIER` creates/updates `cashierCharge`.
- `store.cashier-variances.tsx` is read-only queue/history for audit visibility.
- Charge collection planning and payroll deduction happen in manager payroll routes.
- Deduction amount/timing and gross/net payroll treatment are owned by `CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`.

## Forbidden Shortcuts

1. `PARTIALLY_PAID -> AR list` direct mapping.
2. Using `isOnCredit` alone as AR authority.
3. Treating rider-shortage bridge as new customer open balance.
4. Recomputing prices to derive AR.
5. Re-running customer pricing rules after order creation to change payable totals.

## Audit Checklist (Quick)

1. Every parent order in the delivery flow has frozen pricing snapshot fields on `OrderItem`.
2. Every AR entry has traceable approved CSS decision and `customerAr` row.
3. Every run moved to `CHECKED_IN` has no pending clearance.
4. Every run moved to cashier has completed manager stock audit.
5. Cashier shortage events route to rider shortage workflow.
6. No customer appears on AR list without open `customerAr` balance.
7. Shift close submission and manager final close are traceable per shift.
8. Short variance close has manager decision + paper reference trace.
9. Cashier charge records exist only for short variance with manager `CHARGE_CASHIER`.

## Known Implementation Drift (2026-03-05)

Canonical authority in this document is `STORE_MANAGER`-only for manager stages.
Current code still allows `ADMIN` access in some manager routes; this must be removed in follow-up code patch:

1. `app/routes/store.dispatch.tsx`
2. `app/routes/runs.$id.dispatch.tsx`
3. `app/routes/runs.$id.remit.tsx`
