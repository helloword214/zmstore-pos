-- CreateTable
CREATE TABLE "EmployeeAddress" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "line1" TEXT NOT NULL,
    "provinceId" INTEGER NOT NULL,
    "municipalityId" INTEGER NOT NULL,
    "barangayId" INTEGER NOT NULL,
    "zoneId" INTEGER,
    "landmarkId" INTEGER,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "barangay" TEXT NOT NULL,
    "purok" TEXT,
    "postalCode" TEXT,
    "landmark" TEXT,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAddress_employeeId_key" ON "EmployeeAddress"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAddress_provinceId_idx" ON "EmployeeAddress"("provinceId");

-- CreateIndex
CREATE INDEX "EmployeeAddress_municipalityId_idx" ON "EmployeeAddress"("municipalityId");

-- CreateIndex
CREATE INDEX "EmployeeAddress_barangayId_idx" ON "EmployeeAddress"("barangayId");

-- CreateIndex
CREATE INDEX "EmployeeAddress_zoneId_idx" ON "EmployeeAddress"("zoneId");

-- CreateIndex
CREATE INDEX "EmployeeAddress_landmarkId_idx" ON "EmployeeAddress"("landmarkId");

-- AddForeignKey
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_landmarkId_fkey" FOREIGN KEY ("landmarkId") REFERENCES "Landmark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
