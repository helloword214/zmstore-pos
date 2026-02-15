-- CreateEnum
CREATE TYPE "ClearanceOrigin" AS ENUM ('CASHIER', 'RIDER');

-- CreateEnum
CREATE TYPE "ClearanceClaimType" AS ENUM ('PRICE_BARGAIN', 'PARTIAL_PAYMENT_REQUEST', 'INSUFFICIENT_CASH', 'DELAYED_PAYMENT_REQUEST', 'COMPETITOR_PRICE_MATCH', 'DELIVERY_PAYMENT_FAILED', 'OTHER');

-- CreateEnum
CREATE TYPE "ClearanceCaseStatus" AS ENUM ('NEEDS_CLEARANCE', 'DECIDED', 'RETURNED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClearanceDecisionKind" AS ENUM ('APPROVE_FORCE_DISCOUNT', 'APPROVE_AR', 'APPROVE_HYBRID', 'REJECT', 'CANCEL_SALE');

-- CreateEnum
CREATE TYPE "CustomerArStatus" AS ENUM ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'WAIVED', 'CANCELLED');

-- DropEnum
DROP TYPE "ArStatus";

-- CreateTable
CREATE TABLE "ClearanceCase" (
    "id" SERIAL NOT NULL,
    "status" "ClearanceCaseStatus" NOT NULL DEFAULT 'NEEDS_CLEARANCE',
    "origin" "ClearanceOrigin" NOT NULL,
    "customerId" INTEGER,
    "orderId" INTEGER,
    "runId" INTEGER,
    "runReceiptId" INTEGER,
    "frozenTotal" DECIMAL(12,2) NOT NULL,
    "cashCollected" DECIMAL(12,2) NOT NULL,
    "flaggedById" INTEGER,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearanceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceClaim" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "type" "ClearanceClaimType" NOT NULL,
    "requestedPayable" DECIMAL(12,2),
    "cashAvailable" DECIMAL(12,2),
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearanceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceDecision" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "kind" "ClearanceDecisionKind" NOT NULL,
    "overrideDiscountApproved" DECIMAL(12,2),
    "approvedPayable" DECIMAL(12,2),
    "arBalance" DECIMAL(12,2),
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnToOrigin" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearanceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAr" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "clearanceDecisionId" INTEGER,
    "orderId" INTEGER,
    "runId" INTEGER,
    "principal" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" "CustomerArStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CustomerAr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerArPayment" (
    "id" SERIAL NOT NULL,
    "arId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "refNo" TEXT,
    "shiftId" INTEGER,
    "cashierId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerArPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClearanceCase_status_idx" ON "ClearanceCase"("status");

-- CreateIndex
CREATE INDEX "ClearanceCase_origin_flaggedAt_idx" ON "ClearanceCase"("origin", "flaggedAt");

-- CreateIndex
CREATE INDEX "ClearanceCase_customerId_idx" ON "ClearanceCase"("customerId");

-- CreateIndex
CREATE INDEX "ClearanceCase_orderId_idx" ON "ClearanceCase"("orderId");

-- CreateIndex
CREATE INDEX "ClearanceCase_runId_idx" ON "ClearanceCase"("runId");

-- CreateIndex
CREATE INDEX "ClearanceCase_runReceiptId_idx" ON "ClearanceCase"("runReceiptId");

-- CreateIndex
CREATE INDEX "ClearanceClaim_caseId_type_idx" ON "ClearanceClaim"("caseId", "type");

-- CreateIndex
CREATE INDEX "ClearanceDecision_caseId_decidedAt_idx" ON "ClearanceDecision"("caseId", "decidedAt");

-- CreateIndex
CREATE INDEX "ClearanceDecision_kind_idx" ON "ClearanceDecision"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAr_clearanceDecisionId_key" ON "CustomerAr"("clearanceDecisionId");

-- CreateIndex
CREATE INDEX "CustomerAr_customerId_status_idx" ON "CustomerAr"("customerId", "status");

-- CreateIndex
CREATE INDEX "CustomerAr_orderId_idx" ON "CustomerAr"("orderId");

-- CreateIndex
CREATE INDEX "CustomerAr_runId_idx" ON "CustomerAr"("runId");

-- CreateIndex
CREATE INDEX "CustomerAr_createdAt_idx" ON "CustomerAr"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerArPayment_arId_idx" ON "CustomerArPayment"("arId");

-- CreateIndex
CREATE INDEX "CustomerArPayment_cashierId_createdAt_idx" ON "CustomerArPayment"("cashierId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClearanceCase" ADD CONSTRAINT "ClearanceCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceCase" ADD CONSTRAINT "ClearanceCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceCase" ADD CONSTRAINT "ClearanceCase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceCase" ADD CONSTRAINT "ClearanceCase_runReceiptId_fkey" FOREIGN KEY ("runReceiptId") REFERENCES "RunReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceCase" ADD CONSTRAINT "ClearanceCase_flaggedById_fkey" FOREIGN KEY ("flaggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceClaim" ADD CONSTRAINT "ClearanceClaim_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClearanceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceDecision" ADD CONSTRAINT "ClearanceDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceDecision" ADD CONSTRAINT "ClearanceDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClearanceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAr" ADD CONSTRAINT "CustomerAr_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAr" ADD CONSTRAINT "CustomerAr_clearanceDecisionId_fkey" FOREIGN KEY ("clearanceDecisionId") REFERENCES "ClearanceDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAr" ADD CONSTRAINT "CustomerAr_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAr" ADD CONSTRAINT "CustomerAr_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerArPayment" ADD CONSTRAINT "CustomerArPayment_arId_fkey" FOREIGN KEY ("arId") REFERENCES "CustomerAr"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerArPayment" ADD CONSTRAINT "CustomerArPayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerArPayment" ADD CONSTRAINT "CustomerArPayment_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
