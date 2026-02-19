# Delivery + CSS + AR Diagrams

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-19
Diagram Version: v1.1

## Purpose

Visual map for the canonical flow described in:

- `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
- `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
- `docs/guide/Commercial Clearance System V2`
- `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`

## 1) End-to-End Flow

```mermaid
flowchart TD
    A["Dispatch (PLANNED -> DISPATCHED)"] --> B["Rider Check-in (receipts + cash)"]
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
    S --> T["Manager shift close (FINAL_CLOSED)"]
    T --> U{"Cashier variance decision path"}
    U -- "CHARGE_CASHIER" --> V["Cashier charge ledger -> payroll settlement"]
    U -- "INFO_ONLY / WAIVE" --> W["Variance audit closed"]
    H --> X["AR list/ledger from open customerAr balances"]
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
    A["RunReceipt + RunReceiptLine (frozen lines and rider cash)"] --> B["clearanceCase + clearanceDecision (commercial authority)"]
    B --> C["customerAr (approved AR principal and balance)"]
    D["Payment (cash and settlement postings)"] --> C
    A --> E["Cashier turnover expected cash view"]
    D --> F["Cash drawer truth"]
    C --> G["AR list and customer ledger"]
```

## 4) Route-Level Swimlane

```mermaid
flowchart LR
    subgraph Manager["Manager Routes"]
        M0["store.dispatch.tsx"]
        M1["runs.$id.dispatch.tsx"]
        M2["runs.$id.summary.tsx"]
        M3["store.clearance.tsx"]
        M4["store.clearance_.$caseId.tsx"]
        M5["runs.$id.remit.tsx"]
        M6["store.cashier-shifts.tsx"]
        M7["store.cashier-variances.tsx"]
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

    M0 --> M1 --> R1 --> M2
    R1 --> M3 --> M4 --> M5
    M5 --> C1 --> C2 --> C3
    C4 --> C5 --> M6 --> M7 --> C6 --> M8
    M4 --> A1 --> A2
```

## 5) Route-to-SoT Matrix (Condensed)

| Route | SoT read/write anchor |
| --- | --- |
| `runs.$id.rider-checkin.tsx` | `runReceipt`, `clearanceCase` |
| `store.clearance_.$caseId.tsx` | `clearanceDecision`, `customerAr` |
| `runs.$id.remit.tsx` | stock recap + run close records |
| `cashier.delivery.$runId.tsx` | turnover comparison (`runReceipt.cashCollected` vs `payment`) |
| `delivery-remit.$id.tsx` | per-order `payment` + shortage bridge records |
| `cashier.$id.tsx` | walk-in cash posting to `payment` (shift-tagged) |
| `cashier.shift.tsx` | shift status transitions + close count submission |
| `store.cashier-shifts.tsx` | manager open/final-close control |
| `store.cashier-variances.tsx` | manager variance decision + cashier charge linkage |
| `cashier.charges.tsx` | cashier acknowledgement trail for charged variances |
| `store.cashier-ar.tsx` | cashier charge list and payroll-tag planning |
| `store.payroll.tsx` | payroll deduction posting and status synchronization |
| `ar._index.tsx` | customer AR list authority |
| `ar.customers.$id.tsx` | customer AR ledger/payments |

## 6) Cashier Shift Audit Path (As-Is Note)

```mermaid
flowchart TD
    A["Cashier submits denomination count"] --> B["Shift status = SUBMITTED (locked)"]
    B --> C["Manager closes shift (FINAL_CLOSED)"]
    C --> D{"Variance row exists?"}
    D -- "Yes" --> E["Manager decides: CHARGE_CASHIER / INFO_ONLY / WAIVE"]
    E --> F["If short + charged: create/update CashierCharge"]
    F --> G["Cashier acknowledge / payroll deduction"]
    D -- "No" --> H["No in-route variance decision path available"]
```

As-is control note:

1. Current shift close route is status-gated and does not itself create `CashierShiftVariance`.
2. Independent manager recount workflow is a documented hardening target.

## Diagram Upgrade Rule

1. Minor (`v1.x`) for additive nodes/links without rule changes.
2. Major (`v2.0`) when business rules or SoT authority changes.
3. Any major update must also update:
   - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
   - `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
   - `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`
