-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "expirationDate" TIMESTAMP(3),
ADD COLUMN     "imageTag" TEXT,
ADD COLUMN     "marketPrice" DOUBLE PRECISION,
ADD COLUMN     "originalPrice" DOUBLE PRECISION,
ADD COLUMN     "packingSize" TEXT,
ADD COLUMN     "quantity" DOUBLE PRECISION,
ADD COLUMN     "replenishAt" TIMESTAMP(3),
ADD COLUMN     "unitType" TEXT;
