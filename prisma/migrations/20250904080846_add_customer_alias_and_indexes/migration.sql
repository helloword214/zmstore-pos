/*
  Warnings:

  - You are about to drop the column `mobile` on the `Customer` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[phone]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Customer_mobile_idx";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "mobile",
ADD COLUMN     "alias" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_alias_idx" ON "Customer"("alias");
