/*
  Warnings:

  - A unique constraint covering the columns `[receiptId]` on the table `RiderRunVariance` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[runId,riderId,shiftId]` on the table `RiderRunVariance` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RiderRunVariance" ADD COLUMN     "receiptId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "RiderRunVariance_receiptId_key" ON "RiderRunVariance"("receiptId");

-- CreateIndex
CREATE INDEX "RiderRunVariance_receiptId_idx" ON "RiderRunVariance"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRunVariance_runId_riderId_shiftId_key" ON "RiderRunVariance"("runId", "riderId", "shiftId");

-- AddForeignKey
ALTER TABLE "RiderRunVariance" ADD CONSTRAINT "RiderRunVariance_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "RunReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
