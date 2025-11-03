-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "barangayId" INTEGER,
ADD COLUMN     "landmarkId" INTEGER,
ADD COLUMN     "municipalityId" INTEGER,
ADD COLUMN     "purok" TEXT,
ADD COLUMN     "zoneId" INTEGER;

-- CreateTable
CREATE TABLE "Municipality" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" VARCHAR(16),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "provinceId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Municipality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barangay" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" VARCHAR(16),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "municipalityId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barangay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "barangayId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Landmark" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "barangayId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Municipality_provinceId_idx" ON "Municipality"("provinceId");

-- CreateIndex
CREATE INDEX "Municipality_isActive_idx" ON "Municipality"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Municipality_provinceId_name_key" ON "Municipality"("provinceId", "name");

-- CreateIndex
CREATE INDEX "Barangay_municipalityId_idx" ON "Barangay"("municipalityId");

-- CreateIndex
CREATE INDEX "Barangay_isActive_idx" ON "Barangay"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Barangay_municipalityId_name_key" ON "Barangay"("municipalityId", "name");

-- CreateIndex
CREATE INDEX "Zone_barangayId_idx" ON "Zone"("barangayId");

-- CreateIndex
CREATE INDEX "Zone_isActive_idx" ON "Zone"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_barangayId_name_key" ON "Zone"("barangayId", "name");

-- CreateIndex
CREATE INDEX "Landmark_barangayId_idx" ON "Landmark"("barangayId");

-- CreateIndex
CREATE INDEX "Landmark_isActive_idx" ON "Landmark"("isActive");

-- CreateIndex
CREATE INDEX "CustomerAddress_provinceId_idx" ON "CustomerAddress"("provinceId");

-- CreateIndex
CREATE INDEX "CustomerAddress_municipalityId_idx" ON "CustomerAddress"("municipalityId");

-- CreateIndex
CREATE INDEX "CustomerAddress_barangayId_idx" ON "CustomerAddress"("barangayId");

-- CreateIndex
CREATE INDEX "CustomerAddress_zoneId_idx" ON "CustomerAddress"("zoneId");

-- CreateIndex
CREATE INDEX "CustomerAddress_landmarkId_idx" ON "CustomerAddress"("landmarkId");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_landmarkId_fkey" FOREIGN KEY ("landmarkId") REFERENCES "Landmark"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Municipality" ADD CONSTRAINT "Municipality_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barangay" ADD CONSTRAINT "Barangay_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Landmark" ADD CONSTRAINT "Landmark_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
