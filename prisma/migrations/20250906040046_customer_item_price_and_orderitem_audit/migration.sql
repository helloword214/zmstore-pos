/*
  Warnings:

  - You are about to alter the column `value` on the `CustomerItemPrice` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `qty` on the `OrderItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `unitPrice` on the `OrderItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `lineTotal` on the `OrderItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - A unique constraint covering the columns `[customerId,productId,unitKind,startsAt,endsAt]` on the table `CustomerItemPrice` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "CustomerItemPrice_customerId_productId_unitKind_active_idx";

-- AlterTable
ALTER TABLE "CustomerItemPrice" ALTER COLUMN "value" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "allowedUnitPrice" DECIMAL(10,2),
ADD COLUMN     "discountApprovedBy" TEXT,
ADD COLUMN     "pricePolicy" TEXT,
ALTER COLUMN "qty" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "lineTotal" SET DATA TYPE DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "CustomerItemPrice_customerId_productId_unitKind_idx" ON "CustomerItemPrice"("customerId", "productId", "unitKind");

-- CreateIndex
CREATE INDEX "CustomerItemPrice_active_startsAt_endsAt_idx" ON "CustomerItemPrice"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerItemPrice_customerId_productId_unitKind_startsAt_en_key" ON "CustomerItemPrice"("customerId", "productId", "unitKind", "startsAt", "endsAt");
