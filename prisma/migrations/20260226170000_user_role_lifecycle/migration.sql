-- CreateEnum
CREATE TYPE "ManagerKind" AS ENUM ('OWNER', 'STAFF');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "managerKind" "ManagerKind",
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1;

-- Backfill manager kind for existing employee-linked managers.
UPDATE "User"
SET "managerKind" = 'STAFF'
WHERE "role" = 'STORE_MANAGER'
  AND "employeeId" IS NOT NULL
  AND "managerKind" IS NULL;

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "UserRole" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "changedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAuditEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "beforeRole" "UserRole" NOT NULL,
    "afterRole" "UserRole" NOT NULL,
    "reason" TEXT,
    "changedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAuditEvent_pkey" PRIMARY KEY ("id")
);

-- Backfill one active assignment row per existing user
INSERT INTO "UserRoleAssignment" (
    "userId",
    "role",
    "startedAt",
    "endedAt",
    "reason",
    "changedById",
    "createdAt"
)
SELECT
    u."id",
    u."role",
    COALESCE(u."updatedAt", u."createdAt", CURRENT_TIMESTAMP),
    NULL,
    'BACKFILL_INITIAL_ROLE_ASSIGNMENT',
    NULL,
    CURRENT_TIMESTAMP
FROM "User" u;

-- Guard: prevent silent failure when enforcing one employee -> one user.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "employeeId" IS NOT NULL
    GROUP BY "employeeId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null User.employeeId rows exist; resolve before applying User_employeeId_key.';
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_userId_startedAt_idx" ON "UserRoleAssignment"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_role_endedAt_idx" ON "UserRoleAssignment"("role", "endedAt");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_changedById_createdAt_idx" ON "UserRoleAssignment"("changedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_active_key" ON "UserRoleAssignment"("userId") WHERE "endedAt" IS NULL;

-- CreateIndex
CREATE INDEX "UserRoleAuditEvent_userId_createdAt_idx" ON "UserRoleAuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserRoleAuditEvent_changedById_createdAt_idx" ON "UserRoleAuditEvent"("changedById", "createdAt");

-- CreateIndex
CREATE INDEX "UserRoleAuditEvent_afterRole_createdAt_idx" ON "UserRoleAuditEvent"("afterRole", "createdAt");

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAuditEvent" ADD CONSTRAINT "UserRoleAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAuditEvent" ADD CONSTRAINT "UserRoleAuditEvent_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
