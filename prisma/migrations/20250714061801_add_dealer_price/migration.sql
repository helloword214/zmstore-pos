/*
  Warnings:

  - You are about to drop the column `marketPrice` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `originalPrice` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "marketPrice",
DROP COLUMN "originalPrice",
ADD COLUMN     "dealerPrice" DOUBLE PRECISION,
ADD COLUMN     "srp" DOUBLE PRECISION,
ADD COLUMN     "uses" TEXT[];
