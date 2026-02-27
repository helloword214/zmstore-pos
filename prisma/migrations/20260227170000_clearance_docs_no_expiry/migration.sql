-- Normalize historical clearance rows: clear expiry values for hiring/reference clearances
UPDATE "EmployeeDocument"
SET "expiresAt" = NULL
WHERE "docType" IN ('BARANGAY_CLEARANCE', 'POLICE_CLEARANCE', 'NBI_CLEARANCE')
  AND "expiresAt" IS NOT NULL;

-- Enforce non-expiring clearance policy at DB level
ALTER TABLE "EmployeeDocument"
DROP CONSTRAINT IF EXISTS "EmployeeDocument_clearance_no_expiry_chk";

ALTER TABLE "EmployeeDocument"
ADD CONSTRAINT "EmployeeDocument_clearance_no_expiry_chk"
CHECK (
  "docType" NOT IN ('BARANGAY_CLEARANCE', 'POLICE_CLEARANCE', 'NBI_CLEARANCE')
  OR "expiresAt" IS NULL
);
