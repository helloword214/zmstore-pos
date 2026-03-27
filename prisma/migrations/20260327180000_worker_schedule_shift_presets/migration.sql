CREATE TABLE "WorkerScheduleShiftPreset" (
    "id" SERIAL NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerScheduleShiftPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerScheduleShiftPreset_startMinute_endMinute_key"
ON "WorkerScheduleShiftPreset"("startMinute", "endMinute");

CREATE INDEX "WorkerScheduleShiftPreset_startMinute_endMinute_idx"
ON "WorkerScheduleShiftPreset"("startMinute", "endMinute");

ALTER TABLE "WorkerScheduleShiftPreset"
ADD CONSTRAINT "WorkerScheduleShiftPreset_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkerScheduleShiftPreset"
ADD CONSTRAINT "WorkerScheduleShiftPreset_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "WorkerScheduleShiftPreset" ("startMinute", "endMinute", "createdById", "updatedById")
VALUES
  (360, 900, NULL, NULL),
  (540, 1140, NULL, NULL);
