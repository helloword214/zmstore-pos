-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('RETAIL', 'PACK');

-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('FIXED_PRICE', 'FIXED_DISCOUNT', 'PERCENT_DISCOUNT');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tier" TEXT;

-- CreateTable
CREATE TABLE "CustomerItemPrice" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "unitKind" "UnitKind" NOT NULL,
    "mode" "PriceMode" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerItemPrice_customerId_productId_unitKind_active_idx" ON "CustomerItemPrice"("customerId", "productId", "unitKind", "active");

-- AddForeignKey
ALTER TABLE "CustomerItemPrice" ADD CONSTRAINT "CustomerItemPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerItemPrice" ADD CONSTRAINT "CustomerItemPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
