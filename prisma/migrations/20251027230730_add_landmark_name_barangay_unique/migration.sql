/*
  Warnings:

  - A unique constraint covering the columns `[name,barangayId]` on the table `Landmark` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Landmark_name_barangayId_key" ON "Landmark"("name", "barangayId");
