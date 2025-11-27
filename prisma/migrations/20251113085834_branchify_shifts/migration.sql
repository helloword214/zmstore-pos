
CREATE TABLE "Branch" (
  "id"   SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL
);
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

CREATE TABLE "UserBranch" (
  "userId"   INTEGER NOT NULL,
  "branchId" INTEGER NOT NULL,
  CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("userId","branchId")
);
CREATE INDEX "UserBranch_branchId_idx" ON "UserBranch"("branchId");

-- 2) Add branchId to CashierShift as NULLABLE first (so existing rows are allowed)
ALTER TABLE "CashierShift" ADD COLUMN "branchId" INTEGER;

-- 3) Seed Branch from existing Location names (1:1 by name)
INSERT INTO "Branch" ("name")
SELECT l."name" FROM "Location" l
ON CONFLICT ("name") DO NOTHING;

-- 4) Backfill CashierShift.branchId via locationId -> Location.name -> Branch.id
UPDATE "CashierShift" cs
SET "branchId" = b."id"
FROM "Location" l
JOIN "Branch"  b ON b."name" = l."name"
WHERE cs."branchId" IS NULL
  AND cs."locationId" = l."id";

-- 5) Fallback: ensure a default branch for any remaining NULLs (should be none, but safe)
INSERT INTO "Branch" ("name") VALUES ('Main Branch')
ON CONFLICT ("name") DO NOTHING;
UPDATE "CashierShift" cs
SET "branchId" = b."id"
FROM "Branch" b
WHERE cs."branchId" IS NULL
  AND b."name" = 'Main Branch';

-- 6) Seed UserBranch from existing UserLocation mappings
INSERT INTO "UserBranch" ("userId","branchId")
SELECT ul."userId", b."id"
FROM "UserLocation" ul
JOIN "Location" l ON l."id" = ul."locationId"
JOIN "Branch"  b ON b."name" = l."name"
ON CONFLICT ("userId","branchId") DO NOTHING;

-- 7) Make branchId required and add FK + (optional) index
ALTER TABLE "CashierShift" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "CashierShift_branchId_idx" ON "CashierShift"("branchId");
ALTER TABLE "CashierShift"
  ADD CONSTRAINT "CashierShift_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 8) Add FKs for UserBranch
ALTER TABLE "UserBranch"
  ADD CONSTRAINT "UserBranch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBranch"
  ADD CONSTRAINT "UserBranch_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;