/*
  Warnings:

  - The values [APPROVE_FORCE_DISCOUNT,APPROVE_AR] on the enum `ClearanceDecisionKind` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[receiptKey]` on the table `ClearanceCase` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `receiptKey` to the `ClearanceCase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ClearanceDecisionKind_new" AS ENUM ('APPROVE_DISCOUNT_OVERRIDE', 'APPROVE_OPEN_BALANCE', 'APPROVE_HYBRID', 'REJECT', 'CANCEL_SALE');
ALTER TABLE "ClearanceDecision" ALTER COLUMN "kind" TYPE "ClearanceDecisionKind_new" USING ("kind"::text::"ClearanceDecisionKind_new");
ALTER TYPE "ClearanceDecisionKind" RENAME TO "ClearanceDecisionKind_old";
ALTER TYPE "ClearanceDecisionKind_new" RENAME TO "ClearanceDecisionKind";
DROP TYPE "ClearanceDecisionKind_old";
COMMIT;

-- AlterTable
ALTER TABLE "ClearanceCase" ADD COLUMN     "receiptKey" VARCHAR(64) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceCase_receiptKey_key" ON "ClearanceCase"("receiptKey");
