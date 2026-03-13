# Canonical Upload + File Storage SoT

Status: LOCKED  
Owner: POS Platform  
Last Reviewed: 2026-03-13

## Purpose

Define one authoritative contract for file uploads so implementation stays consistent, auditable, and safe across admin forms.

## Owns

This document owns:

1. `app/utils/storage.server.ts`
2. `app/features/uploads/upload-policy.ts`
3. `app/routes/customers.new.tsx`
4. `app/routes/customers.$id.tsx`
5. `app/routes/customers.$id_.edit.tsx`
6. `app/routes/creation.employees_.new.tsx`
7. `app/routes/creation.employees_.$employeeId.edit.tsx`
8. `app/routes/products._index.tsx`
9. `app/routes/products.$productId.tsx`
10. Upload metadata fields in `prisma/schema.prisma`

## Does Not Own

This document does not own:

1. business authority for cashier variance, delivery flow, AR flow, or payroll
2. role-access boundaries and account authority
3. product pricing or sell-shape rules
4. CDN/image transformation strategy beyond current server-side processing
5. IDOR authorization hardening rollout plan (tracked separately)

## Refer To

1. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for employee document policy and role authority boundaries
2. `CANONICAL_PRODUCTLIST_SHAPE_SOT.md` for product image model scope
3. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` if future cashier recount-form scan attachments are added

## Canonical Storage Boundary (Binding)

1. Binary file content must be stored in the storage driver only (`local` or `s3`).
2. Database stores metadata only (`fileKey`, `fileUrl`, `mimeType`, `sizeBytes`, `uploadedAt`, and related references).
3. Database must not store absolute local machine paths.
4. API/UI consumers use `fileUrl` for retrieval and `fileKey` for lifecycle operations (replace/delete/cleanup).

## Runtime Driver Contract (Binding)

1. `STORAGE_DRIVER=local` writes under `UPLOADS_DIR` and returns URL `/uploads/<key>`.
2. `STORAGE_DRIVER=s3` writes object keys to configured bucket and returns URL from:
   1. `PUBLIC_URL_PREFIX` if provided.
   2. Otherwise endpoint-derived URL for S3-compatible mode.
   3. Otherwise AWS S3 URL format.
3. Storage key path traversal must stay blocked (`normalizeKeyPrefix` + safe local path resolution).

## Upload Validation Contract (Binding)

1. All upload routes must use shared helpers in `app/features/uploads/upload-policy.ts`.
2. Size limits must resolve from env-specific caps with `MAX_UPLOAD_MB` fallback.
3. MIME allow-lists:
   1. Images: `image/jpeg`, `image/png`, `image/webp`.
   2. Employee docs: image allow-list plus `application/pdf`.

## Naming Convention Policy (Tight, Non-Broad)

### A. Segment Rules (Binding)

1. Use lower-case structural segments only.
2. Never include PII in key paths (name, phone, email, address text).
3. Include entity scope in path (parent id and child id where relevant).
4. Use explicit artifact segments (`profile`, `photos`, `documents`, `primary`, `images`).
5. If any free-form segment is required, sanitize to `[a-z0-9_-]` only.

### B. Implemented Prefixes (As-Is, 2026-03-03)

1. Customer profile: `customers/<customerId>/profile`
2. Customer address photos: `customers/<customerId>/addresses/<addressId>/photos`
3. Employee document uploads: `employees/<employeeId>/documents/<docType>`
4. Product image uploads:
   1. Existing product: `products/<productId>/primary`
   2. Pre-create draft cover path: `products/draft/<uploadSessionKey>/primary`
   3. Existing product gallery slot path: `products/<productId>/images/slot-<slot>`
   4. Pre-create draft gallery slot path: `products/draft/<uploadSessionKey>/images/slot-<slot>`

### C. Draft Session Key Contract (Binding)

1. Product create/edit forms must submit `uploadSessionKey` as hidden metadata when posting to `/products`.
2. If `uploadSessionKey` is missing/invalid, server must generate a sanitized fallback key and still avoid broad prefixes.
3. Keep generated filename random/time-based from storage driver; route code must not accept user-supplied key names.
4. Product detail route (`/products/:productId`) is view-only for photos and must not host file upload controls.

## Data Model Contract (Binding)

1. Product supports optional gallery photos via `ProductPhoto` with slot uniqueness (`productId + slot`) and fixed range `1..4`.
2. `Product.imageUrl`/`Product.imageKey` remain as cover-image mirror fields (lowest available slot).
3. Customer profile photo uses `Customer.photoUrl` and `Customer.photoKey`.
4. Customer address gallery is modeled by `CustomerAddressPhoto` with slot uniqueness (`customerAddressId + slot`).
5. Employee compliance documents are stored as append-only history rows in `EmployeeDocument`.

## Lifecycle Rules (Binding)

1. Replace flows should delete old object key after successful DB update when safe.
2. Append-history flows (employee docs) should not delete older objects by default.
3. Cleanup jobs may remove orphaned objects after metadata verification.

## Runtime Status and Known Drift (2026-03-03)

1. Product routes are missing explicit `requireRole` guards and need guard alignment with admin policy.
2. Customer profile and address photo replace flows currently do not consistently delete old object keys.
3. Product draft upload keying is now scoped by `uploadSessionKey`; remaining risk is legacy clients that do not send this field (server fallback handles scope).

## Cross-Doc Contract

1. Read with `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md` for employee document policy and role authority.
2. Read with `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md` for product image model scope.
3. If upload/storage behavior changes, this document must be updated in the same objective/PR.
