# POS Data Model

> **Purpose**  
> Logical schema (not code) for Orders, Payments, Fulfillment, Delivery, Discounts, Customers, and LPG.

---

## Entities

- **Product**

  - `name`, `categoryId`, `brandId`
  - Prices: `price` (retail/unit), `srp` (per pack), `dealerPrice` (cost basis)
  - Units: `unitId` (retail), `packingUnitId` (pack), `packingSize`
  - **Stock**:
    - `stock` = **pack count** (e.g., sacks/tanks)
    - `packingStock` = **retail units** (kg/pcs)
  - LPG composite:
    - `lpgFamily` (e.g., `CATGAS`, `BRANDED`), optional
    - `lpgBrandPriceList` (map of brand→price) OR separate `PriceList` table
  - Flags: `allowPackSale`, `isActive`, `minStock`
  - Index: `(isActive, categoryId, brandId)`

- **Order**

  - `orderCode` (short code for ticket/barcode)
  - `status` enum: `DRAFT | UNPAID | PARTIALLY_PAID | PAID | CANCELLED | VOIDED`
  - **Totals (snapshots)**: `subtotal`, `totalBeforeDiscount`, `discountTotal` (optional), `grandTotal`
  - **Slip/Print meta**: `printCount`, `printedAt`, `expiryAt`, `terminalId`
  - **Payment/Receipt**: `receiptNo`, `paidAt`
  - **Credit/Release**: `isOnCredit` (bool), `dueDate`, `releaseWithBalance` (bool), `releasedApprovedBy`
  - **Relations**: `customerId?`, `items[]`, `payments[]`, `discounts[]`, `fulfillment?`
  - **Locking**: `lockedAt`, `lockedBy`, `lockNote`
  - Indexes: `(status, expiryAt)`, `(lockedAt)`, `(customerId)`

- **OrderItem**

  - `orderId`, `productId`
  - Snapshots: `name`, `qty` (float for retail), `unitPrice`, `lineTotal`
  - Optional: `mode` (`retail|pack`), `unitLabel`
  - Invariants: `lineTotal = round(qty * unitPrice, 2)`

- **Payment**

  - `orderId`
  - `method` enum: `CASH | CARD | GCASH | COD | AR_SETTLEMENT` (etc.)
  - `amount` (₱), `refNo?`, `createdAt`
  - (For delivery remit: use `method = COD` when rider turns over cash)

- **Discount** (amount-based)

  - `orderId` (or `orderItemId` for line-level)
  - `amount` (₱ positive)
  - `reason` (text), `appliedBy`, `approvedBy?`
  - Guardrails enforced in app (do not go below SKU floor price)

- **Customer**

  - Split names: `firstName`, `middleName?`, `lastName`, `suffix?`
  - Contacts: `mobile`, `phone?`, `email?`
  - Flags: `isActive`, `notes?`, `creditLimit?`
  - Relations: `addresses[]`

- **CustomerAddress**

  - `customerId`
  - `label` (e.g., “Home”, “Store”)
  - `line1`, `barangay`, `city`, `province`, `postalCode?`
  - `landmark?`, `geoLat?`, `geoLng?`

- **Fulfillment**

  - `orderId`
  - `state`: `NEW | PICKING | PACKING | DISPATCHED | DELIVERED | ON_HOLD`
  - Timestamps per stage; `pickedBy`, `packedBy`, `dispatchedBy`, `deliveredBy`
  - Delivery fields: `deliveryAgentId?`, `vehicle?`, `notes?`

- **DeliveryAgent** (rider or store staff)

  - `name`, `mobile?`, `isActive`
  - Shared for dedicated riders & store personnel who deliver occasionally

- **RemitBatch** (end-of-day delivery settlement)

  - `agentId`, `openedAt`, `closedAt?`
  - `orders[]` included in batch
  - `cashTurnedOver`, `nonCashNotes`, `variance?`
  - When closing: apply `Payments` to orders (COD/partial), print batch summary

- **CylinderLoan** (LPG)

  - `customerId`, `brandFamily` (`CATGAS`/etc.), `qty`, `openedAt`, `closedAt?`, `notes`
  - Tracks borrowed empties until returned

- **ReceiptCounter**

  - `branchKey` (or global), `currentNo` → allocate sequential `receiptNo`

- **AuditLog**
  - Who did what and when (discounts, overrides, voids, releases, stock ops)

---

## Derived/Business Rules

- **Floor price** per SKU:
  - Retail minimum ≈ `dealerPrice / packingSize`
  - Pack minimum ≈ `dealerPrice`
  - App prevents pricing below floor without manager approval.
- **Composite LPG**: price chosen by selected brand; stock deducts from the **family’s** pool.
- **AR**: sum of `balanceDue` over orders with `status IN (UNPAID, PARTIALLY_PAID)`.
