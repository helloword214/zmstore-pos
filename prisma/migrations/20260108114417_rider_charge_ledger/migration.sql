-- CreateEnum
CREATE TYPE "RiderChargeStatus" AS ENUM ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'WAIVED');

-- CreateEnum
CREATE TYPE "RiderChargePaymentMethod" AS ENUM ('CASH', 'PAYROLL_DEDUCTION', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "RiderCharge" (
    "id" SERIAL NOT NULL,
    "varianceId" INTEGER,
    "runId" INTEGER,
    "riderId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RiderChargeStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdById" INTEGER,

    CONSTRAINT "RiderCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderChargePayment" (
    "id" SERIAL NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RiderChargePaymentMethod" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "refNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftId" INTEGER,
    "cashierId" INTEGER,

    CONSTRAINT "RiderChargePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderCharge_varianceId_key" ON "RiderCharge"("varianceId");

-- CreateIndex
CREATE INDEX "RiderCharge_riderId_status_idx" ON "RiderCharge"("riderId", "status");

-- CreateIndex
CREATE INDEX "RiderCharge_runId_idx" ON "RiderCharge"("runId");

-- CreateIndex
CREATE INDEX "RiderCharge_createdAt_idx" ON "RiderCharge"("createdAt");

-- CreateIndex
CREATE INDEX "RiderChargePayment_chargeId_idx" ON "RiderChargePayment"("chargeId");

-- CreateIndex
CREATE INDEX "RiderChargePayment_cashierId_createdAt_idx" ON "RiderChargePayment"("cashierId", "createdAt");

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_varianceId_fkey" FOREIGN KEY ("varianceId") REFERENCES "RiderRunVariance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderChargePayment" ADD CONSTRAINT "RiderChargePayment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "RiderCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderChargePayment" ADD CONSTRAINT "RiderChargePayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderChargePayment" ADD CONSTRAINT "RiderChargePayment_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
