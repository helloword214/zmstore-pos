/*
  Warnings:

  - A unique constraint covering the columns `[name,categoryId]` on the table `Target` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `categoryId` to the `Target` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "categoryId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Target_name_categoryId_key" ON "Target"("name", "categoryId");

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
