-- AlterTable
ALTER TABLE "RunReceipt" ADD COLUMN     "voidReason" VARCHAR(200),
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" INTEGER;

-- AddForeignKey
ALTER TABLE "RunReceipt" ADD CONSTRAINT "RunReceipt_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
