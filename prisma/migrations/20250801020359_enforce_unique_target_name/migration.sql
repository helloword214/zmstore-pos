/*
  Warnings:

  - A unique constraint covering the columns `[name,categoryId]` on the table `Target` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Target_name_categoryId_key" ON "Target"("name", "categoryId");
