-- CreateEnum
CREATE TYPE "RiderVarianceResolution" AS ENUM ('CHARGE_RIDER', 'WAIVE', 'INFO_ONLY');

-- CreateEnum
CREATE TYPE "ArStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OverrideKind" ADD VALUE 'AR_APPROVE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RiderVarianceStatus" ADD VALUE 'MANAGER_APPROVED';
ALTER TYPE "RiderVarianceStatus" ADD VALUE 'RIDER_ACCEPTED';
ALTER TYPE "RiderVarianceStatus" ADD VALUE 'WAIVED';

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "subtotal" DROP NOT NULL,
ALTER COLUMN "totalBeforeDiscount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RiderRunVariance" ADD COLUMN     "managerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "managerApprovedById" INTEGER,
ADD COLUMN     "resolution" "RiderVarianceResolution",
ADD COLUMN     "riderAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "riderAcceptedById" INTEGER;

-- CreateIndex
CREATE INDEX "RiderRunVariance_managerApprovedAt_idx" ON "RiderRunVariance"("managerApprovedAt");

-- CreateIndex
CREATE INDEX "RiderRunVariance_riderAcceptedAt_idx" ON "RiderRunVariance"("riderAcceptedAt");

-- AddForeignKey
ALTER TABLE "RiderRunVariance" ADD CONSTRAINT "RiderRunVariance_managerApprovedById_fkey" FOREIGN KEY ("managerApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRunVariance" ADD CONSTRAINT "RiderRunVariance_riderAcceptedById_fkey" FOREIGN KEY ("riderAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
