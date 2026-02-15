-- DropForeignKey
ALTER TABLE "CashierShift" DROP CONSTRAINT "CashierShift_branchId_fkey";

-- AlterTable
ALTER TABLE "CashierShift" ALTER COLUMN "branchId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
