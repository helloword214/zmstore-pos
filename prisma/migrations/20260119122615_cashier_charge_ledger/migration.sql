-- CreateEnum
CREATE TYPE "CashierChargeStatus" AS ENUM ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'WAIVED');

-- CreateEnum
CREATE TYPE "CashierChargePaymentMethod" AS ENUM ('CASH', 'FUND_TRANSFER', 'PAYROLL_DEDUCTION', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CashierCharge" (
    "id" SERIAL NOT NULL,
    "varianceId" INTEGER,
    "shiftId" INTEGER,
    "cashierId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "CashierChargeStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdById" INTEGER,

    CONSTRAINT "CashierCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierChargePayment" (
    "id" SERIAL NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "CashierChargePaymentMethod" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "refNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftId" INTEGER,
    "cashierId" INTEGER,

    CONSTRAINT "CashierChargePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashierCharge_varianceId_key" ON "CashierCharge"("varianceId");

-- CreateIndex
CREATE INDEX "CashierCharge_cashierId_status_idx" ON "CashierCharge"("cashierId", "status");

-- CreateIndex
CREATE INDEX "CashierCharge_shiftId_idx" ON "CashierCharge"("shiftId");

-- CreateIndex
CREATE INDEX "CashierCharge_createdAt_idx" ON "CashierCharge"("createdAt");

-- CreateIndex
CREATE INDEX "CashierChargePayment_chargeId_idx" ON "CashierChargePayment"("chargeId");

-- CreateIndex
CREATE INDEX "CashierChargePayment_cashierId_createdAt_idx" ON "CashierChargePayment"("cashierId", "createdAt");

-- AddForeignKey
ALTER TABLE "CashierCharge" ADD CONSTRAINT "CashierCharge_varianceId_fkey" FOREIGN KEY ("varianceId") REFERENCES "CashierShiftVariance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierCharge" ADD CONSTRAINT "CashierCharge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierCharge" ADD CONSTRAINT "CashierCharge_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierCharge" ADD CONSTRAINT "CashierCharge_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierChargePayment" ADD CONSTRAINT "CashierChargePayment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "CashierCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierChargePayment" ADD CONSTRAINT "CashierChargePayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierChargePayment" ADD CONSTRAINT "CashierChargePayment_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
