-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "packingUnitId" INTEGER;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_packingUnitId_fkey" FOREIGN KEY ("packingUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
