-- CreateEnum
CREATE TYPE "EmployeeDocumentType" AS ENUM ('BARANGAY_CLEARANCE', 'VALID_ID', 'DRIVER_LICENSE_SCAN', 'OTHER');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "licenseExpiry" TIMESTAMP(3),
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "middleName" TEXT,
ADD COLUMN     "pagIbigNumber" TEXT,
ADD COLUMN     "sssNumber" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "crNumber" TEXT,
ADD COLUMN     "ltoRegistrationExpiry" TIMESTAMP(3),
ADD COLUMN     "orNumber" TEXT,
ADD COLUMN     "plateNumber" TEXT;

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "docType" "EmployeeDocumentType" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "uploadedById" INTEGER,
    "notes" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_docType_uploadedAt_idx" ON "EmployeeDocument"("employeeId", "docType", "uploadedAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_docType_expiresAt_idx" ON "EmployeeDocument"("docType", "expiresAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_uploadedById_uploadedAt_idx" ON "EmployeeDocument"("uploadedById", "uploadedAt");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
