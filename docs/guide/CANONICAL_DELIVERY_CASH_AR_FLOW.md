# Canonical Delivery -> Cashier -> AR Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-21
Supersedes: `DELIVERY_RUN_CANONICAL_FLOW.md` (behavioral overlap)
Archived: `docs/archive/guide/DELIVERY_RUN_CANONICAL_FLOW.md`

## Purpose

Defines one end-to-end behavior for:

- dispatch
- rider check-in + CSS
- manager remit + stock audit
- cashier turnover audit
- cashier shift close + manager recount decision
- AR ledger entry authority

Visual map reference:

- `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md`
- `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`

## Core Rule Set

1. `PARTIALLY_PAID` is operational state only.
2. Customer AR authority is `customerAr` only.
3. `customerAr` rows are created only from manager-approved CSS decisions with `arBalance > 0`.
4. Rider shortage is rider-accountability flow; it must not create customer AR by itself.

## Authoritative Route Map

This map is the primary route-level reference for the current implementation.

| Stage | Role | Route file | Primary responsibility | SoT focus |
| --- | --- | --- | --- | --- |
| Dispatch queue | Manager | `app/routes/store.dispatch.tsx` | Select delivery orders and create/assign run | Order eligibility only, no AR authority |
| Run staging | Manager | `app/routes/runs.$id.dispatch.tsx` | Assign rider/vehicle/loadout and dispatch run | `deliveryRun`, `deliveryRunOrder`, `runReceipt` bootstrap |
| Run summary | Manager/Rider | `app/routes/runs.$id.summary.tsx` | Read-only recap per run stage | `runReceipt`, `clearanceCase/decision`, recap services |
| Rider check-in | Rider | `app/routes/runs.$id.rider-checkin.tsx` | Encode receipt cash and send clearance requests | `runReceipt`, `clearanceCase(status=NEEDS_CLEARANCE)` |
| Clearance inbox | Manager | `app/routes/store.clearance.tsx` | View pending clearance workload | `clearanceCase` pending list |
| Clearance decision | Manager | `app/routes/store.clearance_.$caseId.tsx` | Approve/reject and classify decision | `clearanceDecision`, `customerAr` creation when `arBalance > 0` |
| Manager remit | Manager | `app/routes/runs.$id.remit.tsx` | Stock audit and close run | Stock return/missing flow, no direct AR authority |
| Cashier run list | Cashier | `app/routes/cashier.delivery._index.tsx` | Open closed runs for turnover remit | Run/order cash turnover visibility |
| Cashier run remit hub | Cashier | `app/routes/cashier.delivery.$runId.tsx` | Track turnover cash gap and finalize run settlement | `runReceipt.cashCollected` vs cashier cash payments |
| Cashier order remit | Cashier | `app/routes/delivery-remit.$id.tsx` | Post per-order cash turnover | `payment` + rider shortage bridge workflow |
| Shift console | Cashier | `app/routes/cashier.shift.tsx` | Opening verification, drawer txns, close count submit | `cashierShift` lifecycle and closing count snapshot |
| Shift manager panel | Manager | `app/routes/store.cashier-shifts.tsx` | Open shift, manager recount, decision capture, final close | Shift status authority + variance/charge write authority at close |
| Cashier variance review | Manager | `app/routes/store.cashier-variances.tsx` | Read-only variance queue/history | `cashierShiftVariance` audit visibility |
| Cashier charge acknowledgement | Cashier | `app/routes/cashier.charges.tsx` | Acknowledge manager-charged items | Charged variance visibility and acknowledgement trail |
| Cashier AR payroll tagging | Manager | `app/routes/store.cashier-ar.tsx` | Tag cashier charge items for payroll collection plan | Cashier charge collection planning |
| Payroll settlement | Manager | `app/routes/store.payroll.tsx` | Record payroll deductions against charge ledgers | Charge payment posting and variance status sync |
| AR customer list | Cashier | `app/routes/ar._index.tsx` | List customers with open approved balances | `customerAr` authority (target behavior) |
| AR customer ledger | Cashier | `app/routes/ar.customers.$id.tsx` | Post and review customer AR payments, show post-submit feedback, print receipt proof | `customerAr` ledger/payment application |

## Route SoT Guardrails

| Route file | Must never do |
| --- | --- |
| `app/routes/runs.$id.rider-checkin.tsx` | Auto-approve AR/discount without manager decision |
| `app/routes/runs.$id.remit.tsx` | Infer customer AR from `PARTIALLY_PAID` alone |
| `app/routes/cashier.delivery.$runId.tsx` | Treat turnover shortage as automatic customer AR |
| `app/routes/delivery-remit.$id.tsx` | Recompute prices from product table for remit totals |
| `app/routes/cashier.shift.tsx` | Re-open shift or keep drawer writable after count submit |
| `app/routes/store.cashier-shifts.tsx` | Final-close without submitted gate, manager recount, and shortage controls (decision + paper ref) |
| `app/routes/store.cashier-variances.tsx` | Accept decision writes; manager decisions are captured at final close in `store.cashier-shifts.tsx` |
| `app/routes/cashier.charges.tsx` | Allow non-owner cashier to acknowledge another cashier charge |
| `app/routes/ar._index.tsx` | Build AR list directly from open order status only |
| `app/routes/ar.customers.$id.tsx` | Create AR principal without decision-backed authority |

## Stage Flow

### T1 Dispatch (`PLANNED -> DISPATCHED`)

- Assign rider, vehicle, loadout.
- Prepare run-linked receipt structures for PARENT orders.
- No AR creation here.

### T2 Rider Check-in (Commercial Gate)

Per receipt:

- Compute `remaining = frozenTotal - cashCollected`.
- If `remaining <= EPS`: settled by cash.
- If `remaining > EPS`: must create `ClearanceCase(status=NEEDS_CLEARANCE)`.

Submit gate:

- Run cannot move to `CHECKED_IN` when any receipt is pending clearance or unresolved reject.

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

### T4 Manager Remit (Stock Audit, not AR Authority)

- Validate stock returns and missing stocks.
- Missing stock may trigger rider charge/variance path.
- Close run to `CLOSED` only after checks pass.

### T5 Cashier Delivery Remit (Money Turnover Audit)

- Compare rider-collected cash SoT vs cashier-recorded cash.
- Handle turnover shortage using rider-shortage workflow.
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

## Forbidden Shortcuts

1. `PARTIALLY_PAID -> AR list` direct mapping.
2. Using `isOnCredit` alone as AR authority.
3. Treating rider-shortage bridge as new customer utang.
4. Recomputing prices to derive AR.

## Audit Checklist (Quick)

1. Every AR entry has traceable approved CSS decision and `customerAr` row.
2. Every run moved to `CHECKED_IN` has no pending clearance.
3. Every run moved to cashier has completed manager stock audit.
4. Cashier shortage events route to rider shortage workflow.
5. No customer appears on AR list without open `customerAr` balance.
6. Shift close submission and manager final close are traceable per shift.
7. Short variance close has manager decision + paper reference trace.
8. Cashier charge records exist only for short variance with manager `CHARGE_CASHIER`.
