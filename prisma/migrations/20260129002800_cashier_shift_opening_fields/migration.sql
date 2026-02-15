-- AlterTable
ALTER TABLE "CashierShift"
  ADD COLUMN IF NOT EXISTS "openingCounted" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "openingDisputeNote" TEXT,
  ADD COLUMN IF NOT EXISTS "openingVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "openingVerifiedById" INTEGER,
  ALTER COLUMN "status" SET DEFAULT 'PENDING_ACCEPT';

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CashierShift_openingVerifiedById_idx"
  ON "CashierShift"("openingVerifiedById");

-- AddForeignKey
ALTER TABLE "CashierShift"
  ADD CONSTRAINT "CashierShift_openingVerifiedById_fkey"
  FOREIGN KEY ("openingVerifiedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
