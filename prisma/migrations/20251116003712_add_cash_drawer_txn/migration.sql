-- CreateEnum
CREATE TYPE "CashDrawerTxnType" AS ENUM ('CASH_IN', 'CASH_OUT', 'DROP', 'ADJUST');

-- CreateTable
CREATE TABLE "CashDrawerTxn" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "type" "CashDrawerTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,

    CONSTRAINT "CashDrawerTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDrawerTxn_shiftId_idx" ON "CashDrawerTxn"("shiftId");

-- CreateIndex
CREATE INDEX "CashDrawerTxn_createdById_idx" ON "CashDrawerTxn"("createdById");

-- AddForeignKey
ALTER TABLE "CashDrawerTxn" ADD CONSTRAINT "CashDrawerTxn_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerTxn" ADD CONSTRAINT "CashDrawerTxn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
