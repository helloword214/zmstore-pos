# POS Permissions Matrix (v2 with SELLER)

## Roles

- **ADMIN**
- **STORE_MANAGER**
- **CASHIER**
- **SELLER**
- **RIDER**

---

## 1. Pricing & Discounts

| Action                                         | Admin | Store Manager | Cashier | Seller | Rider |
| ---------------------------------------------- | ----- | ------------- | ------- | ------ | ----- |
| Edit product base price                        | ✔     | ❌            | ❌      | ❌     | ❌    |
| Create/edit discount groups                    | ✔     | ❌            | ❌      | ❌     | ❌    |
| Give manager-level discount (up to X%)         | ✔     | ✔             | ❌      | ❌     | ❌    |
| Give small preset discount (e.g., suki 5%)     | ✔     | ✔             | ✔       | ❌     | ❌    |
| Approve exceptional discount (> manager limit) | ✔     | ❌            | ❌      | ❌     | ❌    |
| View discount audit trail                      | ✔     | ✔             | ❌      | ❌     | ❌    |

---

## 2. AR / Utang (Accounts Receivable)

| Action                           | Admin     | Store Manager | Cashier | Seller | Rider |
| -------------------------------- | --------- | ------------- | ------- | ------ | ----- |
| Approve AR / charge-to-account   | ✔         | ✔             | ❌      | ❌     | ❌    |
| Set AR credit limit per customer | ✔         | ✔             | ❌      | ❌     | ❌    |
| Encode AR (already approved)     | ✔         | ✔             | ✔       | ❌     | ❌    |
| Adjust AR balance                | ✔         | ✔             | ❌      | ❌     | ❌    |
| Approve AR write-off             | ✔         | ❌            | ❌      | ❌     | ❌    |
| View AR ledger                   | ✔         | ✔             | ✔       | ❌     | ❌    |
| Responsible for uncollected AR   | ✔ (final) | ✔ (primary)   | ❌      | ❌     | ❌    |

---

## 3. Remit / Cash Handling

| Action                           | Admin | Store Manager | Cashier | Seller | Rider |
| -------------------------------- | ----- | ------------- | ------- | ------ | ----- |
| View remit dashboard             | ✔     | ✔             | ✔       | ❌     | ❌    |
| Accept remit (cash, GCash, etc.) | ✔     | ❌            | ✔       | ❌     | ❌    |
| Record partial remit / variance  | ✔     | ✔             | ✔       | ❌     | ❌    |
| Approve shortage justification   | ✔     | ✔             | ❌      | ❌     | ❌    |
| Approve overage handling         | ✔     | ✔             | ❌      | ❌     | ❌    |
| Responsible for shortage         | ❌    | ❌            | ❌      | ❌     | ✔     |

---

## 4. Delivery Run (Pad-Order → Dispatch → Return)

> Note: Kung kailangan mag-deliver ang SELLER, bibigyan siya ng **RIDER** role. Ang permissions sa table na ’to ay core per role.

| Action                          | Admin | Store Manager | Cashier | Seller | Rider                  |
| ------------------------------- | ----- | ------------- | ------- | ------ | ---------------------- |
| Create delivery run             | ✔     | ✔             | ❌      | ❌     | ❌                     |
| Assign rider & vehicle          | ✔     | ✔             | ❌      | ❌     | ❌                     |
| Dispatch run                    | ✔     | ✔             | ❌      | ❌     | ❌                     |
| Encode loadout (initial)        | ✔     | ✔             | ❌      | ❌     | ✔ (if part of process) |
| Close inventory (sold/returned) | ✔     | ✔             | ❌      | ❌     | ❌                     |
| View run summary                | ✔     | ✔             | ✔       | ❌     | ✔ (own runs)           |
| Remit run (cash side)           | ✔     | ❌            | ✔       | ❌     | ❌                     |

---

## 5. Inventory & Stock Movements

| Action                                  | Admin | Store Manager | Cashier | Seller | Rider                      |
| --------------------------------------- | ----- | ------------- | ------- | ------ | -------------------------- |
| Perform stock adjustments               | ✔     | ✔             | ❌      | ❌     | ❌                         |
| Approve stock variance                  | ✔     | ✔             | ❌      | ❌     | ❌                         |
| Create stock movements (loadout/return) | ✔     | ✔             | ❌      | ❌     | ✔ (return only if allowed) |
| View inventory (read-only)              | ✔     | ✔             | ✔       | ✔      | ❌                         |

---

## 6. Orders / Sales

| Action                             | Admin | Store Manager | Cashier          | Seller         | Rider |
| ---------------------------------- | ----- | ------------- | ---------------- | -------------- | ----- |
| Create order (walk-in)             | ✔     | ✔             | ✔                | ✔              | ❌    |
| Create order (pad-order)           | ✔     | ✔             | ✔                | ✔ (if allowed) | ❌    |
| Encode loadout sale (adhoc on run) | ✔     | ✔             | ❌               | ❌             | ✔     |
| Apply discount                     | ✔     | ✔             | ✔ (within limit) | ❌             | ❌    |
| Convert order to AR                | ✔     | ✔             | ❌               | ❌             | ❌    |
| View own created orders            | ✔     | ✔             | ✔                | ✔              | ❌    |

---

## 7. Overall System Access

| Action                     | Admin | Store Manager | Cashier           | Seller                     | Rider         |
| -------------------------- | ----- | ------------- | ----------------- | -------------------------- | ------------- |
| Access admin settings      | ✔     | ❌            | ❌                | ❌                         | ❌            |
| Manage users & roles       | ✔     | ❌            | ❌                | ❌                         | ❌            |
| View audit logs            | ✔     | ✔             | ❌                | ❌                         | ❌            |
| Access store dashboards    | ✔     | ✔             | ✔                 | Limited (own sales/orders) | ❌            |
| Access delivery dashboards | ✔     | ✔             | Cash summary only | ❌                         | Own runs only |

---

## Key Accountability Summary

### Admin

- Final decision-maker (pricing, AR, write-offs)
- Full access to audit trails
- Owner of pricing list and discount groups

### Store Manager

- Primary owner of inventory, discount approvals, AR approvals
- Accountable sa lahat ng AR na siya ang nag-approve
- Accountable sa manager-level discounts
- Owner ng inventory close sa delivery runs

### Cashier

- Execution-only for payments
- Accepts remit and customer payments
- Cannot approve AR or large discounts
- Responsible for cash handling on shift

### Seller

- Taga-assist ng walk-in clients
- Gumagawa at nag-eencode ng walk-in at pad-orders
- Walang remit, AR, inventory adjustment, o discount authority
- Focused sa **order entry** and **customer assistance**

### Rider

- Responsible for COD shortage (remit short) unless approved/justified
- No authority on pricing, discounts, or AR
- Involved sa delivery runs, loadout, at returns (inventory movement side)

+**Statuses:**
+- `PLANNED` → `DISPATCHED` → `CHECK_IN` → `CLOSED` → `COMPLETED`

- +| Transition | Admin | Store Manager | Cashier | Seller | Rider |
  +| ---------------------------------------------- | ----- | ------------- | ------- | ------ | ----- |
  +| Create run in `PLANNED` | ✔ | ✔ | ❌ | ❌ | ❌ |
  +| Edit `PLANNED` run (loadout, rider, vehicle) | ✔ | ✔ | ❌ | ❌ | ❌ |
  +| Mark `PLANNED → DISPATCHED` | ✔ | ✔ | ❌ | ❌ | ❌ |
  +| Encode sales + returns during `CHECK_IN` | ✔ | ✔ | ❌ | ❌ | ✔ (own run only) |
  +| Mark run as `CHECK_IN` (rider finished encode) | ✔ | ✔ | ❌ | ❌ | ✔ (own run only) |
  +| Review + approve `CHECK_IN → CLOSED` | ✔ | ✔ | ❌ | ❌ | ❌ |
  +| View closed runs for remit | ✔ | ✔ | ✔ | ❌ | ❌ |
  +| Accept remit + mark `CLOSED → COMPLETED` | ✔ | ❌ | ✔ | ❌ | ❌ |
- +**Notes:**
  +- For **pure runs** (walang parent order), same lifecycle pa rin — lahat ng sales sa `CHECK_IN` side lang papasok.
  +- Kung **SELLER ang magde-deliver**, bibigyan siya ng **RIDER** role for that run (same as note sa Section 4).
