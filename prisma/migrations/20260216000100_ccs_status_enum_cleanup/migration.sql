-- CCS v2.7: ClearanceCaseStatus cleanup
-- Keep only NEEDS_CLEARANCE / DECIDED.
-- Guard first: abort if legacy rows still exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ClearanceCase"
    WHERE "status"::text IN ('RETURNED', 'CLOSED', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION
      'CCS status cleanup blocked: legacy ClearanceCase.status rows exist (RETURNED/CLOSED/CANCELLED). Resolve data first.';
  END IF;
END
$$;

-- Rebuild enum safely (PostgreSQL enum value removal requires type rebuild).
ALTER TYPE "ClearanceCaseStatus" RENAME TO "ClearanceCaseStatus_old";

CREATE TYPE "ClearanceCaseStatus" AS ENUM (
  'NEEDS_CLEARANCE',
  'DECIDED'
);

ALTER TABLE "ClearanceCase"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "ClearanceCase"
  ALTER COLUMN "status" TYPE "ClearanceCaseStatus"
  USING ("status"::text::"ClearanceCaseStatus");

ALTER TABLE "ClearanceCase"
  ALTER COLUMN "status" SET DEFAULT 'NEEDS_CLEARANCE';

DROP TYPE "ClearanceCaseStatus_old";
