-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "isOnCredit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "releaseWithBalance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "releasedApprovedBy" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CylinderLoan" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "brandFamily" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "CylinderLoan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CylinderLoan_customerId_closedAt_idx" ON "CylinderLoan"("customerId", "closedAt");

-- AddForeignKey
ALTER TABLE "CylinderLoan" ADD CONSTRAINT "CylinderLoan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
