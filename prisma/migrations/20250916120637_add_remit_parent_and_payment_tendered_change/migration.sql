-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "remitGroup" VARCHAR(64),
ADD COLUMN     "remitParentId" INTEGER;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "change" DECIMAL(10,2),
ADD COLUMN     "tendered" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "Order_remitGroup_idx" ON "Order"("remitGroup");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_remitParentId_fkey" FOREIGN KEY ("remitParentId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
