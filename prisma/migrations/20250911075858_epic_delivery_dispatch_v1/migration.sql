-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('STAFF', 'RIDER', 'MANAGER');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRICYCLE', 'MOTORCYCLE', 'SIDECAR', 'MULTICAB', 'VAN', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('LOADOUT_OUT', 'RETURN_IN', 'ADHOC_SALE_OUT');

-- CreateEnum
CREATE TYPE "StockRefKind" AS ENUM ('ORDER', 'RUN');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OverrideKind" AS ENUM ('CAPACITY_EXCEED', 'PRICE_BELOW_ALLOWED', 'MANUAL_RETURN_ADJUST');

-- AlterEnum
ALTER TYPE "FulfillmentStatus" ADD VALUE 'STAGED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "loadoutSnapshot" JSONB,
ADD COLUMN     "riderId" INTEGER,
ADD COLUMN     "stagedAt" TIMESTAMP(3),
ADD COLUMN     "vehicleId" INTEGER,
ADD COLUMN     "vehicleName" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "unitKind" "UnitKind";

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "alias" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "role" "EmployeeRole" NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultVehicleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "capacityUnits" DOUBLE PRECISION,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCapacityProfile" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "maxUnits" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "VehicleCapacityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "refKind" "StockRefKind",
    "refId" INTEGER,
    "locationFrom" TEXT,
    "locationTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRun" (
    "id" SERIAL NOT NULL,
    "runCode" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PLANNED',
    "riderId" INTEGER,
    "vehicleId" INTEGER,
    "loadoutSnapshot" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRunOrder" (
    "runId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "sequence" INTEGER,

    CONSTRAINT "DeliveryRunOrder_pkey" PRIMARY KEY ("runId","orderId")
);

-- CreateTable
CREATE TABLE "RunAdhocSale" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunAdhocSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverrideLog" (
    "id" SERIAL NOT NULL,
    "kind" "OverrideKind" NOT NULL,
    "orderId" INTEGER,
    "runId" INTEGER,
    "approvedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverrideLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_role_active_idx" ON "Employee"("role", "active");

-- CreateIndex
CREATE INDEX "Vehicle_active_idx" ON "Vehicle"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_name_type_key" ON "Vehicle"("name", "type");

-- CreateIndex
CREATE INDEX "VehicleCapacityProfile_vehicleId_idx" ON "VehicleCapacityProfile"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCapacityProfile_vehicleId_key_key" ON "VehicleCapacityProfile"("vehicleId", "key");

-- CreateIndex
CREATE INDEX "StockMovement_type_productId_idx" ON "StockMovement"("type", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_refKind_refId_idx" ON "StockMovement"("refKind", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRun_runCode_key" ON "DeliveryRun"("runCode");

-- CreateIndex
CREATE INDEX "DeliveryRun_status_idx" ON "DeliveryRun"("status");

-- CreateIndex
CREATE INDEX "DeliveryRun_riderId_idx" ON "DeliveryRun"("riderId");

-- CreateIndex
CREATE INDEX "DeliveryRun_vehicleId_idx" ON "DeliveryRun"("vehicleId");

-- CreateIndex
CREATE INDEX "DeliveryRunOrder_orderId_idx" ON "DeliveryRunOrder"("orderId");

-- CreateIndex
CREATE INDEX "RunAdhocSale_runId_idx" ON "RunAdhocSale"("runId");

-- CreateIndex
CREATE INDEX "RunAdhocSale_productId_idx" ON "RunAdhocSale"("productId");

-- CreateIndex
CREATE INDEX "OverrideLog_orderId_idx" ON "OverrideLog"("orderId");

-- CreateIndex
CREATE INDEX "OverrideLog_runId_idx" ON "OverrideLog"("runId");

-- CreateIndex
CREATE INDEX "OverrideLog_kind_createdAt_idx" ON "OverrideLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Order_riderId_idx" ON "Order"("riderId");

-- CreateIndex
CREATE INDEX "Order_vehicleId_idx" ON "Order"("vehicleId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_defaultVehicleId_fkey" FOREIGN KEY ("defaultVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCapacityProfile" ADD CONSTRAINT "VehicleCapacityProfile_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunOrder" ADD CONSTRAINT "DeliveryRunOrder_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunOrder" ADD CONSTRAINT "DeliveryRunOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAdhocSale" ADD CONSTRAINT "RunAdhocSale_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAdhocSale" ADD CONSTRAINT "RunAdhocSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverrideLog" ADD CONSTRAINT "OverrideLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverrideLog" ADD CONSTRAINT "OverrideLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
