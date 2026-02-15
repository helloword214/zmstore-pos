-- CreateEnum
CREATE TYPE "RunReceiptKind" AS ENUM ('ROAD', 'PARENT');

-- CreateTable
CREATE TABLE "RunReceipt" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "kind" "RunReceiptKind" NOT NULL DEFAULT 'ROAD',
    "receiptKey" VARCHAR(64) NOT NULL,
    "parentOrderId" INTEGER,
    "customerId" INTEGER,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "cashCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunReceiptLine" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunReceipt_runId_idx" ON "RunReceipt"("runId");

-- CreateIndex
CREATE INDEX "RunReceipt_kind_idx" ON "RunReceipt"("kind");

-- CreateIndex
CREATE INDEX "RunReceipt_customerId_idx" ON "RunReceipt"("customerId");

-- CreateIndex
CREATE INDEX "RunReceipt_parentOrderId_idx" ON "RunReceipt"("parentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "RunReceipt_runId_receiptKey_key" ON "RunReceipt"("runId", "receiptKey");

-- CreateIndex
CREATE INDEX "RunReceiptLine_receiptId_idx" ON "RunReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "RunReceiptLine_productId_idx" ON "RunReceiptLine"("productId");

-- AddForeignKey
ALTER TABLE "RunReceipt" ADD CONSTRAINT "RunReceipt_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunReceipt" ADD CONSTRAINT "RunReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunReceipt" ADD CONSTRAINT "RunReceipt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunReceiptLine" ADD CONSTRAINT "RunReceiptLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunReceiptLine" ADD CONSTRAINT "RunReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "RunReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
