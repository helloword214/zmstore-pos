-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "originRunReceiptId" INTEGER;

-- CreateIndex
CREATE INDEX "Order_originRunReceiptId_idx" ON "Order"("originRunReceiptId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_originRunReceiptId_fkey" FOREIGN KEY ("originRunReceiptId") REFERENCES "RunReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
