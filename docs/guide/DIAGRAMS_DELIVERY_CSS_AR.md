# Delivery + CSS + AR Diagrams

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-26
Diagram Version: v2.0

## Purpose

Visual map for the canonical flow described in:

- `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`
- `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
- `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
- `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
- `docs/guide/Commercial Clearance System V2`
- `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`

## 1) End-to-End Flow

```mermaid
flowchart TD
    A0["Order Pad (/order-pad)"] --> A1["Order Create (/orders/new)"]
    A1 --> A2["Apply policy discounts (customer rules if present)"]
    A2 --> A3["Freeze OrderItem + Order pricing snapshots"]
    A3 --> A["Dispatch (PLANNED -> DISPATCHED)"]
    A --> B["Rider Check-in (receipts + cash)"]
    B --> C{"remaining > EPS?"}
    C -- "No" --> D["Receipt settled by cash"]
    C -- "Yes" --> E["ClearanceCase(status=NEEDS_CLEARANCE)"]
    E --> F["Manager decision"]
    F --> G{"Decision kind"}
    G -- "APPROVE_OPEN_BALANCE / APPROVE_HYBRID" --> H["Create or update customerAr (arBalance > 0)"]
    G -- "APPROVE_DISCOUNT_OVERRIDE" --> I["No customerAr for this receipt"]
    G -- "REJECT" --> J["Full pay or VOIDED"]
    D --> K["Receipt settled"]
    H --> K
    I --> K
    J --> K
    K --> L["Run CHECKED_IN gate passes"]
    L --> M["Manager Remit (stock audit)"]
    M --> N["Run CLOSED"]
    N --> O["Cashier collections (walk-in + delivery remit + AR payment)"]
    O --> P{"Delivery turnover short?"}
    P -- "Yes" --> Q["Rider shortage workflow (variance/charge)"]
    P -- "No" --> R["Run SETTLED"]
    O --> S["Cashier shift count submit (SUBMITTED)"]
    S --> T["Manager recount + final close (/store/cashier-shifts)"]
    T --> U{"Variance on manager recount?"}
    U -- "No" --> V["Shift FINAL_CLOSED"]
    U -- "Yes" --> W["Upsert cashierShiftVariance (manager-authored)"]
    W --> X{"Decision path"}
    X -- "CHARGE_CASHIER + short" --> Y["Upsert CashierCharge -> payroll settlement"]
    X -- "INFO_ONLY / WAIVE / overage" --> Z["Variance audit trail"]
    H --> AA["AR list/ledger from open customerAr balances"]
```

## 2) Clearance Decision Tree

```mermaid
flowchart TD
    A["Receipt during check-in"] --> B{"remaining > EPS?"}
    B -- "No" --> C["No clearance needed"]
    B -- "Yes" --> D["Send clearance request"]
    D --> E["Manager decision"]
    E --> F{"Approved?"}
    F -- "No (REJECT)" --> G["Collect full cash or mark VOIDED before settled"]
    F -- "Yes" --> H["Input approvedDiscount"]
    H --> I{"approvedDiscount value"}
    I -- "0" --> J["APPROVE_OPEN_BALANCE (arBalance = remaining)"]
    I -- "0 < x < remaining" --> K["APPROVE_HYBRID (discount + AR split)"]
    I -- "x = remaining" --> L["APPROVE_DISCOUNT_OVERRIDE (AR = 0)"]
    J --> M["Create customerAr"]
    K --> M
    L --> N["No customerAr"]
    M --> O["Visible in AR ledger"]
    N --> P["Not visible in AR ledger"]
```

## 3) Source of Truth Ownership

```mermaid
flowchart LR
    A["Product.price/srp + CustomerItemPrice rules"] --> B["orders.new pricing engine (one-time)"]
    B --> C["Order + OrderItem frozen pricing snapshots"]
    C --> D["RunReceipt(PARENT) mirrors + rider cash"]
    D --> E["clearanceCase + clearanceDecision (commercial authority)"]
    E --> F["customerAr (approved AR principal and balance)"]
    G["Payment (cash and settlement postings)"] --> F
    D --> H["Cashier turnover expected cash view"]
    G --> I["Cash drawer truth"]
    F --> J["AR list and customer ledger"]
```

## 4) Route-Level Swimlane

```mermaid
flowchart LR
    subgraph Admin["Admin Creation Routes (creation/setup only)"]
        AD0["_index.tsx"]
        AD1["creation.*"]
        AD2["customers.* admin context"]
    end

    subgraph POS["Order Pricing Routes"]
        P0["pad-order._index.tsx"]
        P1["orders.new.tsx"]
        P2["customers.$id.pricing.*"]
    end

    subgraph Manager["Manager Routes"]
        M0["store.dispatch.tsx"]
        M1["runs.$id.dispatch.tsx"]
        M2["runs.$id.summary.tsx"]
        M3["store.clearance.tsx"]
        M4["store.clearance_.$caseId.tsx"]
        M5["runs.$id.remit.tsx"]
        M6["store.cashier-shifts.tsx"]
        M7["store.cashier-variances.tsx (read-only)"]
        M8["store.cashier-ar.tsx / store.payroll.tsx"]
    end

    subgraph Rider["Rider Routes"]
        R1["runs.$id.rider-checkin.tsx"]
    end

    subgraph Cashier["Cashier Routes"]
        C1["cashier.delivery._index.tsx"]
        C2["cashier.delivery.$runId.tsx"]
        C3["delivery-remit.$id.tsx"]
        C4["cashier.$id.tsx"]
        C5["cashier.shift.tsx"]
        C6["cashier.charges.tsx"]
    end

    subgraph AR["AR Routes"]
        A1["ar._index.tsx"]
        A2["ar.customers.$id.tsx"]
    end

    AD0 --> AD1
    AD0 --> AD2
    P0 --> P1 --> M0
    P2 --> P1
    M0 --> M1 --> R1 --> M2
    R1 --> M3 --> M4 --> M5
    M5 --> C1 --> C2 --> C3
    C4 --> C5 --> M6 --> C6 --> M8
    M6 --> M7
    M4 --> A1 --> A2
```

Authority note:

1. `Admin` lane is creation/setup only.
2. `Manager` lane represents `STORE_MANAGER`-only operational/commercial authority.
3. `ADMIN` must not enter `Manager` lane routes, including read-only access.

## 5) Route-to-SoT Matrix (Condensed)

| Route | SoT read/write anchor |
| --- | --- |
| `pad-order._index.tsx` | client cart/preflight only (not final pricing authority) |
| `orders.new.tsx` | policy discount engine apply + frozen `order/orderItem` pricing snapshots |
| `runs.$id.rider-checkin.tsx` | `runReceipt`, `clearanceCase` |
| `store.clearance_.$caseId.tsx` | `clearanceDecision`, `customerAr` |
| `runs.$id.remit.tsx` | stock recap + run close records |
| `cashier.delivery.$runId.tsx` | turnover comparison (`runReceipt.cashCollected` vs `payment`) |
| `delivery-remit.$id.tsx` | per-order `payment` + shortage bridge records |
| `cashier.$id.tsx` | walk-in cash posting to `payment` (shift-tagged) |
| `cashier.shift.tsx` | shift status transitions + close count submission |
| `store.cashier-shifts.tsx` | manager recount/final-close authority, variance upsert, charge decision write path |
| `store.cashier-variances.tsx` | read-only variance queue/history |
| `cashier.charges.tsx` | cashier acknowledgement trail for charged variances |
| `store.cashier-ar.tsx` | cashier charge list and payroll-tag planning |
| `store.payroll.tsx` | payroll deduction posting and status synchronization |
| `ar._index.tsx` | customer AR list authority |
| `ar.customers.$id.tsx` | customer AR ledger/payments |

## 6) Cashier Shift Audit Path (Current)

```mermaid
flowchart TD
    A["Cashier submits denomination count"] --> B["Shift status = SUBMITTED (cashier locked)"]
    B --> C["Manager recount + optional A4 print form"]
    C --> D{"Variance on manager recount?"}
    D -- "No" --> E["Finalize shift (FINAL_CLOSED)"]
    D -- "Yes" --> F["Apply decision rules (short requires decision + paper ref)"]
    F --> G["Upsert CashierShiftVariance (shiftId authority)"]
    G --> H{"CHARGE_CASHIER + short?"}
    H -- "Yes" --> I["Upsert CashierCharge"]
    H -- "No" --> J["Variance remains audit trail"]
    I --> E
    J --> E
    E --> K["store.cashier-variances read-only queue/history"]
    K --> L["cashier.charges / payroll settlement"]
```

As-implemented control note:

1. Manager decision and variance write path live in `store.cashier-shifts.tsx` during final close.
2. `store.cashier-variances.tsx` is read-only for audit visibility.
3. Short variance close requires decision plus paper reference.
4. A4 variance form is printable from manager shift panel and supports paper reference capture.

## Diagram Upgrade Rule

1. Minor (`v1.x`) for additive nodes/links without rule changes.
2. Major (`v2.0`) when business rules or SoT authority changes.
3. Any major update must also update:
   - `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`
   - `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
   - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
   - `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
   - `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`

## Known Implementation Drift (2026-02-26)

Canonical diagram `v2.0` enforces admin separation from manager lanes.
Current code still allows `ADMIN` in some manager routes and requires follow-up alignment:

1. `app/routes/store.dispatch.tsx`
2. `app/routes/runs.$id.dispatch.tsx`
3. `app/routes/store.clearance.tsx`
4. `app/routes/store.clearance_.$caseId.tsx`
5. `app/routes/runs.$id.remit.tsx`
6. `app/routes/store.cashier-shifts.tsx`
7. `app/routes/store.cashier-variances.tsx`
8. `app/routes/store.cashier-ar.tsx`
9. `app/routes/store.payroll.tsx`
