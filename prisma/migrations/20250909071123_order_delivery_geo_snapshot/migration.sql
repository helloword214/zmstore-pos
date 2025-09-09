-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('NEW', 'PICKING', 'PACKING', 'DISPATCHED', 'DELIVERED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "LpgSwapKind" AS ENUM ('REFILL', 'SWAP_CATGAS', 'UPGRADE_BRANDED');

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "photoUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'PICKUP',
ADD COLUMN     "deliverGeoLat" DOUBLE PRECISION,
ADD COLUMN     "deliverGeoLng" DOUBLE PRECISION,
ADD COLUMN     "deliverLandmark" TEXT,
ADD COLUMN     "deliverPhone" TEXT,
ADD COLUMN     "deliverPhotoKey" TEXT,
ADD COLUMN     "deliverPhotoUrl" TEXT,
ADD COLUMN     "deliverTo" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAddressId" INTEGER,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentStatus" "FulfillmentStatus" DEFAULT 'NEW',
ADD COLUMN     "riderName" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "brandAtSale" TEXT,
ADD COLUMN     "isLpg" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lpgEmptyReturned" DOUBLE PRECISION,
ADD COLUMN     "lpgLoaned" DOUBLE PRECISION,
ADD COLUMN     "lpgSwapKind" "LpgSwapKind";

-- CreateIndex
CREATE INDEX "Order_channel_idx" ON "Order"("channel");

-- CreateIndex
CREATE INDEX "Order_fulfillmentStatus_idx" ON "Order"("fulfillmentStatus");

-- CreateIndex
CREATE INDEX "Order_deliveryAddressId_idx" ON "Order"("deliveryAddressId");

-- CreateIndex
CREATE INDEX "Order_deliverGeoLat_deliverGeoLng_idx" ON "Order"("deliverGeoLat", "deliverGeoLng");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
