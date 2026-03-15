-- Daily-only payroll setup + employee statutory deduction profiles

ALTER TABLE "AttendanceDutyResult"
RENAME COLUMN "baseDailyRate" TO "dailyRate";

UPDATE "AttendanceDutyResult"
SET "dailyRate" = COALESCE("dailyRate", "dailyRateEquivalent");

ALTER TABLE "AttendanceDutyResult"
DROP COLUMN "payBasis",
DROP COLUMN "baseMonthlyRate",
DROP COLUMN "dailyRateEquivalent";

ALTER TABLE "EmployeePayProfile"
DROP COLUMN "payBasis";

ALTER TABLE "EmployeePayProfile"
RENAME COLUMN "baseDailyRate" TO "dailyRate";

UPDATE "EmployeePayProfile"
SET "dailyRate" = COALESCE("dailyRate", "dailyRateEquivalent");

ALTER TABLE "EmployeePayProfile"
ALTER COLUMN "dailyRate" SET NOT NULL;

ALTER TABLE "EmployeePayProfile"
DROP COLUMN "baseMonthlyRate",
DROP COLUMN "dailyRateEquivalent";

CREATE TABLE "EmployeeStatutoryDeductionProfile" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "sssAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "philhealthAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pagIbigAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeStatutoryDeductionProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeStatutoryDeductionProfile_employeeId_effectiveFrom_key"
ON "EmployeeStatutoryDeductionProfile"("employeeId", "effectiveFrom");

CREATE INDEX "EmployeeStatutoryDeductionProfile_employeeId_effectiveTo_idx"
ON "EmployeeStatutoryDeductionProfile"("employeeId", "effectiveTo");

ALTER TABLE "EmployeeStatutoryDeductionProfile"
ADD CONSTRAINT "EmployeeStatutoryDeductionProfile_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeStatutoryDeductionProfile"
ADD CONSTRAINT "EmployeeStatutoryDeductionProfile_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeStatutoryDeductionProfile"
ADD CONSTRAINT "EmployeeStatutoryDeductionProfile_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyPayrollPolicy"
ADD COLUMN "sssDeductionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "philhealthDeductionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pagIbigDeductionEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PayrollRunLine"
ADD COLUMN "chargeDeductionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "statutoryDeductionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "statutoryDeductionSnapshot" JSONB;

UPDATE "PayrollRunLine"
SET "chargeDeductionAmount" = "totalDeductions";

DROP TYPE "EmployeePayBasis";
