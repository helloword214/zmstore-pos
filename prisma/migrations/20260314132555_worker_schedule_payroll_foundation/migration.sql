-- CreateEnum
CREATE TYPE "WorkerScheduleRole" AS ENUM ('CASHIER', 'STORE_MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "WorkerScheduleTemplateStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "WorkerScheduleAssignmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "WorkerScheduleTemplateDayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "WorkerScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorkerScheduleEventType" AS ENUM ('MARKED_ABSENT', 'REPLACEMENT_ASSIGNED', 'REPLACEMENT_REMOVED', 'ON_CALL_ASSIGNED', 'EARLY_OUT_RECORDED', 'EMERGENCY_LEAVE_RECORDED', 'SWAP_REQUESTED', 'SWAP_APPROVED', 'SWAP_DECLINED', 'NO_SHOW_RECORDED', 'SCHEDULE_CANCELLED', 'MANAGER_NOTE_ADDED', 'SUSPENSION_APPLIED', 'SUSPENSION_LIFTED');

-- CreateEnum
CREATE TYPE "AttendanceDayType" AS ENUM ('WORK_DAY', 'REST_DAY', 'REGULAR_HOLIDAY', 'SPECIAL_HOLIDAY');

-- CreateEnum
CREATE TYPE "AttendanceResult" AS ENUM ('WHOLE_DAY', 'HALF_DAY', 'ABSENT', 'LEAVE', 'NOT_REQUIRED', 'SUSPENDED_NO_WORK');

-- CreateEnum
CREATE TYPE "AttendanceWorkContext" AS ENUM ('REGULAR', 'REPLACEMENT', 'ON_CALL');

-- CreateEnum
CREATE TYPE "AttendanceLeaveType" AS ENUM ('SICK_LEAVE');

-- CreateEnum
CREATE TYPE "AttendanceLateFlag" AS ENUM ('NO', 'YES');

-- CreateEnum
CREATE TYPE "SuspensionRecordStatus" AS ENUM ('ACTIVE', 'LIFTED', 'ENDED');

-- CreateEnum
CREATE TYPE "EmployeePayBasis" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SickLeavePayTreatment" AS ENUM ('PAID', 'UNPAID');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PAID', 'VOIDED');

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" SERIAL NOT NULL,
    "templateName" TEXT NOT NULL,
    "branchId" INTEGER,
    "role" "WorkerScheduleRole",
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "WorkerScheduleTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplateDay" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "dayOfWeek" "WorkerScheduleTemplateDayOfWeek" NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTemplateDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplateAssignment" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "workerId" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "WorkerScheduleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTemplateAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerSchedule" (
    "id" SERIAL NOT NULL,
    "workerId" INTEGER NOT NULL,
    "role" "WorkerScheduleRole" NOT NULL,
    "branchId" INTEGER,
    "scheduleDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "templateAssignmentId" INTEGER,
    "status" "WorkerScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "publishedById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDutyResult" (
    "id" SERIAL NOT NULL,
    "workerId" INTEGER NOT NULL,
    "scheduleId" INTEGER,
    "dutyDate" DATE NOT NULL,
    "dayType" "AttendanceDayType" NOT NULL,
    "attendanceResult" "AttendanceResult" NOT NULL,
    "workContext" "AttendanceWorkContext" NOT NULL DEFAULT 'REGULAR',
    "leaveType" "AttendanceLeaveType",
    "lateFlag" "AttendanceLateFlag" NOT NULL DEFAULT 'NO',
    "note" TEXT,
    "recordedById" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payProfileId" INTEGER,
    "payBasis" "EmployeePayBasis",
    "baseDailyRate" DECIMAL(12,2),
    "baseMonthlyRate" DECIMAL(12,2),
    "dailyRateEquivalent" DECIMAL(12,2),
    "halfDayFactor" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDutyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuspensionRecord" (
    "id" SERIAL NOT NULL,
    "workerId" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reasonType" TEXT NOT NULL,
    "managerNote" TEXT,
    "status" "SuspensionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "appliedById" INTEGER,
    "liftedById" INTEGER,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuspensionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "eventType" "WorkerScheduleEventType" NOT NULL,
    "actorUserId" INTEGER,
    "subjectWorkerId" INTEGER NOT NULL,
    "relatedWorkerId" INTEGER,
    "note" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayProfile" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "payBasis" "EmployeePayBasis" NOT NULL,
    "baseDailyRate" DECIMAL(12,2),
    "baseMonthlyRate" DECIMAL(12,2),
    "dailyRateEquivalent" DECIMAL(12,2) NOT NULL,
    "halfDayFactor" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPayrollPolicy" (
    "id" SERIAL NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "payFrequency" "PayrollFrequency" NOT NULL,
    "customCutoffNote" TEXT,
    "restDayWorkedPremiumPercent" DECIMAL(5,2) NOT NULL,
    "regularHolidayWorkedPremiumPercent" DECIMAL(5,2) NOT NULL,
    "specialHolidayWorkedPremiumPercent" DECIMAL(5,2) NOT NULL,
    "sickLeavePayTreatment" "SickLeavePayTreatment" NOT NULL,
    "attendanceIncentiveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "attendanceIncentiveAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "attendanceIncentiveRequireNoLate" BOOLEAN NOT NULL DEFAULT false,
    "attendanceIncentiveRequireNoAbsent" BOOLEAN NOT NULL DEFAULT false,
    "attendanceIncentiveRequireNoSuspension" BOOLEAN NOT NULL DEFAULT false,
    "allowManagerOverride" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPayrollPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" SERIAL NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "payDate" DATE NOT NULL,
    "payFrequency" "PayrollFrequency" NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "companyPayrollPolicyId" INTEGER,
    "policySnapshot" JSONB,
    "managerOverrideSnapshot" JSONB,
    "note" TEXT,
    "createdById" INTEGER,
    "finalizedById" INTEGER,
    "paidById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunLine" (
    "id" SERIAL NOT NULL,
    "payrollRunId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "attendanceSnapshotIds" JSONB,
    "baseAttendancePay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "attendanceIncentiveAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAdditions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "policySnapshot" JSONB,
    "additionSnapshot" JSONB,
    "deductionSnapshot" JSONB,
    "managerOverrideNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleTemplate_branchId_status_idx" ON "ScheduleTemplate"("branchId", "status");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_role_status_idx" ON "ScheduleTemplate"("role", "status");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_effectiveFrom_effectiveTo_idx" ON "ScheduleTemplate"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "ScheduleTemplateDay_dayOfWeek_idx" ON "ScheduleTemplateDay"("dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTemplateDay_templateId_dayOfWeek_key" ON "ScheduleTemplateDay"("templateId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ScheduleTemplateAssignment_workerId_status_effectiveFrom_idx" ON "ScheduleTemplateAssignment"("workerId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ScheduleTemplateAssignment_templateId_status_idx" ON "ScheduleTemplateAssignment"("templateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTemplateAssignment_templateId_workerId_effectiveFro_key" ON "ScheduleTemplateAssignment"("templateId", "workerId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkerSchedule_workerId_scheduleDate_idx" ON "WorkerSchedule"("workerId", "scheduleDate");

-- CreateIndex
CREATE INDEX "WorkerSchedule_status_scheduleDate_idx" ON "WorkerSchedule"("status", "scheduleDate");

-- CreateIndex
CREATE INDEX "WorkerSchedule_branchId_scheduleDate_idx" ON "WorkerSchedule"("branchId", "scheduleDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSchedule_workerId_scheduleDate_startAt_endAt_key" ON "WorkerSchedule"("workerId", "scheduleDate", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDutyResult_scheduleId_key" ON "AttendanceDutyResult"("scheduleId");

-- CreateIndex
CREATE INDEX "AttendanceDutyResult_recordedById_recordedAt_idx" ON "AttendanceDutyResult"("recordedById", "recordedAt");

-- CreateIndex
CREATE INDEX "AttendanceDutyResult_payProfileId_idx" ON "AttendanceDutyResult"("payProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDutyResult_workerId_dutyDate_key" ON "AttendanceDutyResult"("workerId", "dutyDate");

-- CreateIndex
CREATE INDEX "SuspensionRecord_workerId_status_startDate_endDate_idx" ON "SuspensionRecord"("workerId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "SuspensionRecord_appliedById_appliedAt_idx" ON "SuspensionRecord"("appliedById", "appliedAt");

-- CreateIndex
CREATE INDEX "ScheduleEvent_scheduleId_createdAt_idx" ON "ScheduleEvent"("scheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleEvent_actorUserId_createdAt_idx" ON "ScheduleEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleEvent_subjectWorkerId_createdAt_idx" ON "ScheduleEvent"("subjectWorkerId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeePayProfile_employeeId_effectiveTo_idx" ON "EmployeePayProfile"("employeeId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayProfile_employeeId_effectiveFrom_key" ON "EmployeePayProfile"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayrollPolicy_effectiveFrom_key" ON "CompanyPayrollPolicy"("effectiveFrom");

-- CreateIndex
CREATE INDEX "CompanyPayrollPolicy_payFrequency_effectiveFrom_idx" ON "CompanyPayrollPolicy"("payFrequency", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayrollRun_status_payDate_idx" ON "PayrollRun"("status", "payDate");

-- CreateIndex
CREATE INDEX "PayrollRun_periodStart_periodEnd_idx" ON "PayrollRun"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PayrollRun_createdById_createdAt_idx" ON "PayrollRun"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "PayrollRunLine_employeeId_createdAt_idx" ON "PayrollRunLine"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunLine_payrollRunId_employeeId_key" ON "PayrollRunLine"("payrollRunId", "employeeId");

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateDay" ADD CONSTRAINT "ScheduleTemplateDay_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateAssignment" ADD CONSTRAINT "ScheduleTemplateAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateAssignment" ADD CONSTRAINT "ScheduleTemplateAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateAssignment" ADD CONSTRAINT "ScheduleTemplateAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateAssignment" ADD CONSTRAINT "ScheduleTemplateAssignment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSchedule" ADD CONSTRAINT "WorkerSchedule_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSchedule" ADD CONSTRAINT "WorkerSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSchedule" ADD CONSTRAINT "WorkerSchedule_templateAssignmentId_fkey" FOREIGN KEY ("templateAssignmentId") REFERENCES "ScheduleTemplateAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSchedule" ADD CONSTRAINT "WorkerSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSchedule" ADD CONSTRAINT "WorkerSchedule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSchedule" ADD CONSTRAINT "WorkerSchedule_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDutyResult" ADD CONSTRAINT "AttendanceDutyResult_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDutyResult" ADD CONSTRAINT "AttendanceDutyResult_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkerSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDutyResult" ADD CONSTRAINT "AttendanceDutyResult_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDutyResult" ADD CONSTRAINT "AttendanceDutyResult_payProfileId_fkey" FOREIGN KEY ("payProfileId") REFERENCES "EmployeePayProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRecord" ADD CONSTRAINT "SuspensionRecord_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRecord" ADD CONSTRAINT "SuspensionRecord_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRecord" ADD CONSTRAINT "SuspensionRecord_liftedById_fkey" FOREIGN KEY ("liftedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkerSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_subjectWorkerId_fkey" FOREIGN KEY ("subjectWorkerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_relatedWorkerId_fkey" FOREIGN KEY ("relatedWorkerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayProfile" ADD CONSTRAINT "EmployeePayProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayProfile" ADD CONSTRAINT "EmployeePayProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayProfile" ADD CONSTRAINT "EmployeePayProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPayrollPolicy" ADD CONSTRAINT "CompanyPayrollPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPayrollPolicy" ADD CONSTRAINT "CompanyPayrollPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyPayrollPolicyId_fkey" FOREIGN KEY ("companyPayrollPolicyId") REFERENCES "CompanyPayrollPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
