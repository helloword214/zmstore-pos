-- CreateEnum
CREATE TYPE "RiderVarianceStatus" AS ENUM ('OPEN', 'PARTIALLY_SETTLED', 'CLOSED');

-- CreateTable
CREATE TABLE "RiderRunVariance" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "riderId" INTEGER NOT NULL,
    "shiftId" INTEGER,
    "expected" DECIMAL(12,2) NOT NULL,
    "actual" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "status" "RiderVarianceStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RiderRunVariance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderRunVariance_runId_idx" ON "RiderRunVariance"("runId");

-- CreateIndex
CREATE INDEX "RiderRunVariance_riderId_idx" ON "RiderRunVariance"("riderId");

-- CreateIndex
CREATE INDEX "RiderRunVariance_status_idx" ON "RiderRunVariance"("status");

-- AddForeignKey
ALTER TABLE "RiderRunVariance" ADD CONSTRAINT "RiderRunVariance_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRunVariance" ADD CONSTRAINT "RiderRunVariance_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRunVariance" ADD CONSTRAINT "RiderRunVariance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
