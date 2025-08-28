-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "lockNote" TEXT;

-- CreateIndex
CREATE INDEX "Order_status_expiryAt_idx" ON "Order"("status", "expiryAt");

-- CreateIndex
CREATE INDEX "Order_lockedAt_idx" ON "Order"("lockedAt");
