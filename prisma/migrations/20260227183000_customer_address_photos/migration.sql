-- CreateTable
CREATE TABLE "CustomerAddressPhoto" (
    "id" SERIAL NOT NULL,
    "customerAddressId" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddressPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddressPhoto_customerAddressId_slot_key" ON "CustomerAddressPhoto"("customerAddressId", "slot");

-- CreateIndex
CREATE INDEX "CustomerAddressPhoto_customerAddressId_uploadedAt_idx" ON "CustomerAddressPhoto"("customerAddressId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "CustomerAddressPhoto" ADD CONSTRAINT "CustomerAddressPhoto_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "CustomerAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce fixed slot range (1..4) for location photos
ALTER TABLE "CustomerAddressPhoto"
ADD CONSTRAINT "CustomerAddressPhoto_slot_chk"
CHECK ("slot" BETWEEN 1 AND 4);
