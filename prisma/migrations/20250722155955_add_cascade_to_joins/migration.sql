-- DropForeignKey
ALTER TABLE "ProductIndication" DROP CONSTRAINT "ProductIndication_indicationId_fkey";

-- DropForeignKey
ALTER TABLE "ProductIndication" DROP CONSTRAINT "ProductIndication_productId_fkey";

-- DropForeignKey
ALTER TABLE "ProductTarget" DROP CONSTRAINT "ProductTarget_productId_fkey";

-- DropForeignKey
ALTER TABLE "ProductTarget" DROP CONSTRAINT "ProductTarget_targetId_fkey";

-- AddForeignKey
ALTER TABLE "ProductIndication" ADD CONSTRAINT "ProductIndication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIndication" ADD CONSTRAINT "ProductIndication_indicationId_fkey" FOREIGN KEY ("indicationId") REFERENCES "Indication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTarget" ADD CONSTRAINT "ProductTarget_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTarget" ADD CONSTRAINT "ProductTarget_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
