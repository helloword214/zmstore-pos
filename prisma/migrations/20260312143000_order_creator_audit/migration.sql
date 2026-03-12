-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "createdById" INTEGER,
ADD COLUMN "createdByRole" "UserRole";

-- CreateIndex
CREATE INDEX "Order_createdById_createdAt_idx" ON "Order"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "Order_createdByRole_createdAt_idx" ON "Order"("createdByRole", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
