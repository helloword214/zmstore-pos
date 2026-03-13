# Database Schema Duplication Audit

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-13

## Purpose

Document the current database-shape duplications, compatibility bridges, and legacy candidates that should be reviewed before future schema-cleanup work.

This file is an audit/planning artifact. It exists so future cleanup work can start from observed repository evidence instead of re-deriving assumptions.

## Owns

This document owns:

1. the audit framing for schema duplication review
2. the initial repository-observed shortlist of overlapping fields and legacy candidates
3. the cleanup classification model used for future schema-hardening tasks
4. the future review checklist for deciding whether a field/table should stay, be deprecated, or be removed

## Does Not Own

This document does not own:

1. product sell-shape business rules
2. upload/storage lifecycle rules
3. identity/account authority rules
4. pricing freeze rules
5. delivery/cashier/AR business flow rules
6. final schema-drop approval by itself

## Refer To

1. `CANONICAL_PRODUCTLIST_SHAPE_SOT.md` for product shape meaning
2. `CANONICAL_UPLOAD_STORAGE_SOT.md` for file metadata and photo-storage contracts
3. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for user/account boundary rules
4. `CANONICAL_ORDER_PRICING_SOT.md` for frozen order pricing fields
5. `CANONICAL_DELIVERY_CASH_AR_FLOW.md` for delivery snapshot and downstream audit needs

## Scope Boundary

In scope:

1. duplicated fields with different storage shapes but overlapping purpose
2. snapshot fields plus relational fields that may look redundant at first glance
3. legacy tables/columns that appear unused or low-usage
4. migration-history signals that suggest repeated schema retries or historical drift

Out of scope:

1. implementing migrations
2. deleting tables/columns
3. renaming schema entities
4. changing runtime business behavior

## Classification Model

Every future cleanup candidate should be classified into one of these buckets before any patch:

1. `KEEP_INTENTIONAL_SNAPSHOT`
   - duplicated-on-purpose for audit safety, print history, or historical immutability
2. `KEEP_ACTIVE_BRIDGE`
   - old and new shapes coexist because runtime still mirrors data across both
3. `KEEP_ACTIVE_LEGACY`
   - field/model looks legacy but still has active runtime behavior
4. `DEPRECATE_FIRST`
   - no longer the desired shape, but reads/writes still exist or live data must be verified
5. `DROP_CANDIDATE`
   - no active runtime value found yet; still requires DB/data validation before removal

## Audit Notes from Current Repository Review

The repository currently has:

1. `57` Prisma models
2. `34` Prisma enums
3. `89` migration folders

This volume makes historical overlap plausible and means schema cleanup must be staged, not assumed.

## Phase 1 Cleanup Completed (2026-03-13)

Completed in the first low-risk cleanup pass:

1. removed `Order.deliverPhotoKey`
2. removed legacy zero-row models: `Sale`, `SaleItem`, `CylinderLoan`, `OverrideLog`, `RunAdhocSale`
3. removed the now-unused enum `OverrideKind`

Why these were safe enough to remove:

1. repository review found no active runtime value worth preserving
2. current database review showed `0` live rows for the removed tables
3. `deliverPhotoKey` had no active write/read path and `0` non-null rows

## Intentional Snapshot Duplications (Do Not Treat as Bugs by Default)

These are fields that overlap in meaning with relational fields but serve audit/history purposes.

### 1. Customer Address Text Snapshots + Geo Foreign Keys

Observed shape:

1. `CustomerAddress.province`, `city`, `barangay`, `purok`
2. `CustomerAddress.provinceId`, `municipalityId`, `barangayId`, `zoneId`, `landmarkId`

Interpretation:

1. text fields preserve historical address wording
2. FK fields support canonical geo-master linkage
3. this is intentional duplication unless product direction explicitly removes audit snapshots

Future review question:

1. Do all order/delivery/print flows still need address wording frozen independently of master-data edits?

### 2. Order Delivery Snapshot Fields + Delivery Address Reference

Observed shape:

1. `Order.deliveryAddressId`
2. `Order.deliverTo`, `deliverPhone`, `deliverLandmark`, `deliverGeoLat`, `deliverGeoLng`, `deliverPhotoUrl`

Interpretation:

1. linked customer address and frozen delivery facts coexist
2. this is likely intentional because delivery facts must survive future address edits

Future review question:

1. Which downstream routes read the snapshots versus the linked address row, and can that boundary be simplified without losing audit history?

### 3. Employee Address Text Snapshots + Required Geo Foreign Keys

Observed shape:

1. `EmployeeAddress.province`, `city`, `barangay`, `purok`
2. `EmployeeAddress.provinceId`, `municipalityId`, `barangayId`, optional `zoneId`, `landmarkId`

Interpretation:

1. same pattern as customer addresses
2. likely intentional for compliance/history safety

Future review question:

1. Is the employee-address snapshot contract formally required, or can it later be reduced to a narrower frozen subset?

## Active Compatibility Bridges

These are overlaps where old and new shapes currently coexist and runtime still mirrors data.

### 1. Product Cover Fields + Product Photo Gallery

Observed shape:

1. `Product.imageUrl`, `Product.imageKey`, `imageTag`
2. `ProductPhoto` gallery rows (`slot` 1..4)

Current interpretation:

1. `ProductPhoto` is the richer storage model
2. `Product.imageUrl` and `Product.imageKey` still act as cover-image mirror fields
3. cleanup is not safe until all reads/writes stop depending on the mirrored cover fields

Future review questions:

1. Which routes still read only the cover fields?
2. Can UI/listing routes read derived cover data from `ProductPhoto` directly?
3. Is `imageTag` still needed as a standalone concept once photo gallery usage is normalized?

### 2. Customer Address Cover Fields + Customer Address Photo Gallery

Observed shape:

1. `CustomerAddress.photoUrl`, `photoKey`, `photoUpdatedAt`
2. `CustomerAddressPhoto` gallery rows (`slot` 1..4)

Current interpretation:

1. same bridge pattern as product photos
2. likely a cover-photo mirror over the gallery model

Future review questions:

1. Are address screens consuming cover fields for summary cards while gallery drives detail pages?
2. Can a single derived-cover rule replace duplicated storage?

## Active Legacy-Looking Fields That Are Still In Use

These must not be dropped just because comments or names make them look old.

### 1. `User.pinHash`

Observed shape:

1. schema comment marks it as legacy
2. account-security flow still reads and writes it for manager/cashier PIN mutation and PIN-based re-auth

Current interpretation:

1. legacy in original login purpose does not mean dead in current self-service security behavior

Future review question:

1. Is PIN still a required secondary-auth factor for current operations, or should it be formally retired in a later auth-hardening objective?

### 2. `UserBranch`

Observed shape:

1. appears low-touch if only direct model access is searched
2. runtime still uses `user.branches` for branch scoping/session hydration

Current interpretation:

1. low direct delegate usage can still be active through relation includes

Future review question:

1. Should branch scoping remain relational as-is, or be revisited only when multi-branch policy becomes more mature?

## Deferred Legacy / Low-Confidence Cleanup Candidates

These still need a dedicated cleanup decision after Phase 1. They are not approved removals yet.

### Candidate Model Shortlist

1. `Tag`
2. `ProductTag`

Why these are listed:

1. repo review found little or no active app-layer evidence compared with other models
2. unlike the removed Phase 1 tables, these still have live rows in the current database
3. they may represent either stale data structures or unfinished feature intent

Current DB signal captured during review:

1. `Tag` rows: `14`
2. `ProductTag` rows: `308`

Required validation before any change:

1. search indirect relation includes/selects, not just `db.<model>` usage
2. inspect live database row counts and recency
3. confirm no pending feature relies on them
4. confirm no print/audit/reporting path still references them

## Migration-History Drift Signals

Observed during review:

1. duplicated migration slug: `add_run_receipts`
2. duplicated migration slug: `enforce_unique_target_name`

Interpretation:

1. this suggests historical retry/rework patterns
2. migration history itself should be treated as evidence, not proof that final runtime shape is clean

Future review question:

1. Do any later migrations preserve now-obsolete bridge fields that were never formally deprecated in docs?

## Cleanup Decision Workflow for the Next Schema Task

For each candidate field/model:

1. identify owner docs that explain why the data exists
2. classify it using the buckets in this document
3. search all reads, writes, includes, selects, tests, scripts, and seeds
4. verify live DB data volume and whether rows are still being created
5. decide one action only:
   - keep
   - keep but document better
   - deprecate first
   - migrate then drop
6. if business behavior changes, update the owning canonical docs in the same objective

## Minimum Evidence Required Before Dropping Anything

1. no active runtime writes
2. no active runtime reads
3. no required audit/print/history dependency
4. no live data that still matters operationally
5. a documented replacement path if the old shape is being bridged to a new one

## Recommended Next Objective

Title suggestion:

1. `Schema Duplication Cleanup Audit`

Suggested goal:

1. convert this observed shortlist into a decision ledger with one row per table/field and an explicit disposition (`keep`, `bridge`, `deprecate`, `drop candidate`)

Suggested first-pass focus:

1. product image bridge
2. customer address photo bridge
3. `pinHash` lifecycle decision
4. old sales/override/adhoc candidate tables

## Anti-Assumption Rule for Future Cleanup

Do not drop a field/table just because:

1. the name looks legacy
2. a comment says legacy
3. direct delegate usage is low
4. a newer table exists with a similar purpose

Removal must be justified by runtime evidence, data evidence, and owner-doc alignment.
