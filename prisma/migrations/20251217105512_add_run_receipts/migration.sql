-- CreateEnum
CREATE TYPE "RunReceiptStatus" AS ENUM ('DRAFT', 'REVIEWED', 'SETTLED');

-- AlterTable
ALTER TABLE "RunReceipt" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "status" "RunReceiptStatus" NOT NULL DEFAULT 'DRAFT';
