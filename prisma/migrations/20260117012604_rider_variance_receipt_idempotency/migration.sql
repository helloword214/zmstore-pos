-- DropIndex
DROP INDEX "RiderRunVariance_runId_riderId_shiftId_key";

-- CreateIndex
CREATE INDEX "RiderRunVariance_runId_riderId_shiftId_idx" ON "RiderRunVariance"("runId", "riderId", "shiftId");
