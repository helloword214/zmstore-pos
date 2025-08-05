/*
  Warnings:

  - A unique constraint covering the columns `[name,categoryId]` on the table `Brand` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[barcode]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sku]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `unit` to the `SaleItem` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Brand_name_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allowPackSale" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "minStock" DOUBLE PRECISION,
ADD COLUMN     "packingStock" INTEGER,
ADD COLUMN     "sku" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "unit" TEXT NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_categoryId_key" ON "Brand"("name", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
