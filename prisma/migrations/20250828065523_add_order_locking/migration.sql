-- AlterTable (add missing columns first)
ALTER TABLE "Order"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "lockNote" TEXT;

-- CreateIndex
CREATE INDEX "Order_status_expiryAt_idx" ON "Order"("status", "expiryAt");

-- CreateIndex
CREATE INDEX "Order_lockedAt_idx" ON "Order"("lockedAt");
