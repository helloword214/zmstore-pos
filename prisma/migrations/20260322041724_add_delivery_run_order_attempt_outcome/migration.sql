-- CreateEnum
CREATE TYPE "DeliveryAttemptOutcome" AS ENUM ('NO_RELEASE_REATTEMPT', 'NO_RELEASE_CANCELLED');

-- AlterTable
ALTER TABLE "DeliveryRunOrder" ADD COLUMN     "attemptFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "attemptFinalizedById" INTEGER,
ADD COLUMN     "attemptNote" VARCHAR(200),
ADD COLUMN     "attemptOutcome" "DeliveryAttemptOutcome",
ADD COLUMN     "attemptReportedAt" TIMESTAMP(3),
ADD COLUMN     "attemptReportedById" INTEGER;

-- AlterTable
ALTER TABLE "EmployeeStatutoryDeductionProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "DeliveryRunOrder_attemptOutcome_idx" ON "DeliveryRunOrder"("attemptOutcome");

-- CreateIndex
CREATE INDEX "DeliveryRunOrder_attemptReportedById_idx" ON "DeliveryRunOrder"("attemptReportedById");

-- CreateIndex
CREATE INDEX "DeliveryRunOrder_attemptFinalizedById_idx" ON "DeliveryRunOrder"("attemptFinalizedById");

-- AddForeignKey
ALTER TABLE "DeliveryRunOrder" ADD CONSTRAINT "DeliveryRunOrder_attemptReportedById_fkey" FOREIGN KEY ("attemptReportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunOrder" ADD CONSTRAINT "DeliveryRunOrder_attemptFinalizedById_fkey" FOREIGN KEY ("attemptFinalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
