/*
  Warnings:

  - The values [PARTIAL_PAYMENT_REQUEST,INSUFFICIENT_CASH,DELAYED_PAYMENT_REQUEST,COMPETITOR_PRICE_MATCH,DELIVERY_PAYMENT_FAILED] on the enum `ClearanceClaimType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ClearanceClaimType_new" AS ENUM ('OPEN_BALANCE', 'PRICE_BARGAIN', 'OTHER');
ALTER TABLE "ClearanceClaim" ALTER COLUMN "type" TYPE "ClearanceClaimType_new" USING ("type"::text::"ClearanceClaimType_new");
ALTER TYPE "ClearanceClaimType" RENAME TO "ClearanceClaimType_old";
ALTER TYPE "ClearanceClaimType_new" RENAME TO "ClearanceClaimType";
DROP TYPE "ClearanceClaimType_old";
COMMIT;
