/*
  Warnings:

  - You are about to drop the column `uses` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `unit` on the `SaleItem` table. All the data in the column will be lost.
  - You are about to alter the column `quantity` on the `SaleItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "uses",
ADD COLUMN     "indications" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "target" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SaleItem" DROP COLUMN "unit",
ALTER COLUMN "quantity" SET DATA TYPE INTEGER;
