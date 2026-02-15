/*
  Warnings:

  - You are about to alter the column `price` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `stock` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,3)`.
  - You are about to alter the column `dealerPrice` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `srp` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `minStock` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,3)`.
  - You are about to alter the column `packingSize` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,3)`.

*/
-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "stock" SET DATA TYPE DECIMAL(12,3),
ALTER COLUMN "dealerPrice" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "srp" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "minStock" SET DATA TYPE DECIMAL(12,3),
ALTER COLUMN "packingSize" SET DATA TYPE DECIMAL(12,3);
