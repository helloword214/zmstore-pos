/*
  Warnings:

  - You are about to drop the column `locationId` on the `CashierShift` table. All the data in the column will be lost.
  - You are about to drop the `UserLocation` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CashierShift" DROP CONSTRAINT "CashierShift_locationId_fkey";

-- DropForeignKey
ALTER TABLE "UserLocation" DROP CONSTRAINT "UserLocation_locationId_fkey";

-- DropForeignKey
ALTER TABLE "UserLocation" DROP CONSTRAINT "UserLocation_userId_fkey";

-- DropIndex
DROP INDEX "CashierShift_branchId_idx";

-- DropIndex
DROP INDEX "CashierShift_locationId_idx";

-- AlterTable
ALTER TABLE "CashierShift" DROP COLUMN "locationId";

-- DropTable
DROP TABLE "UserLocation";
