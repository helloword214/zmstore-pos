-- CreateEnum
CREATE TYPE "CashierShiftStatus" AS ENUM ('OPEN', 'SUBMITTED', 'RECOUNT_REQUIRED', 'FINAL_CLOSED');

-- AlterTable
ALTER TABLE "CashierShift" ADD COLUMN     "cashierSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "finalClosedById" INTEGER,
ADD COLUMN     "status" "CashierShiftStatus" NOT NULL DEFAULT 'OPEN';

-- CreateIndex
CREATE INDEX "CashierShift_status_idx" ON "CashierShift"("status");

-- CreateIndex
CREATE INDEX "CashierShift_finalClosedById_idx" ON "CashierShift"("finalClosedById");

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_finalClosedById_fkey" FOREIGN KEY ("finalClosedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
