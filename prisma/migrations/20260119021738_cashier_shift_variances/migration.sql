-- CreateEnum
CREATE TYPE "CashierVarianceStatus" AS ENUM ('OPEN', 'MANAGER_APPROVED', 'WAIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashierVarianceResolution" AS ENUM ('CHARGE_CASHIER', 'WAIVE', 'INFO_ONLY');

-- AlterTable
ALTER TABLE "CashierShift" ADD COLUMN     "closingDenoms" JSONB;

-- CreateTable
CREATE TABLE "CashierShiftVariance" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "expected" DECIMAL(12,2) NOT NULL,
    "counted" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "status" "CashierVarianceStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "CashierVarianceResolution",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "managerApprovedAt" TIMESTAMP(3),
    "managerApprovedById" INTEGER,

    CONSTRAINT "CashierShiftVariance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashierShiftVariance_shiftId_key" ON "CashierShiftVariance"("shiftId");

-- CreateIndex
CREATE INDEX "CashierShiftVariance_status_idx" ON "CashierShiftVariance"("status");

-- CreateIndex
CREATE INDEX "CashierShiftVariance_managerApprovedAt_idx" ON "CashierShiftVariance"("managerApprovedAt");

-- AddForeignKey
ALTER TABLE "CashierShiftVariance" ADD CONSTRAINT "CashierShiftVariance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShiftVariance" ADD CONSTRAINT "CashierShiftVariance_managerApprovedById_fkey" FOREIGN KEY ("managerApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
