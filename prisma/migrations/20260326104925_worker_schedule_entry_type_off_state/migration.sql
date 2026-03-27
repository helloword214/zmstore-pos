-- CreateEnum
CREATE TYPE "WorkerScheduleEntryType" AS ENUM ('WORK', 'OFF');

-- AlterTable
ALTER TABLE "WorkerSchedule" ADD COLUMN     "entryType" "WorkerScheduleEntryType" NOT NULL DEFAULT 'WORK';

-- CreateIndex
CREATE INDEX "WorkerSchedule_workerId_scheduleDate_entryType_idx" ON "WorkerSchedule"("workerId", "scheduleDate", "entryType");
