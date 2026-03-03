-- CreateTable
CREATE TABLE "ProductPhoto" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPhoto_productId_slot_key" ON "ProductPhoto"("productId", "slot");

-- CreateIndex
CREATE INDEX "ProductPhoto_productId_uploadedAt_idx" ON "ProductPhoto"("productId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce fixed slot range (1..4) for product photos
ALTER TABLE "ProductPhoto"
ADD CONSTRAINT "ProductPhoto_slot_chk"
CHECK ("slot" BETWEEN 1 AND 4);
