-- Add optional customer profile photo fields
ALTER TABLE "public"."Customer"
ADD COLUMN "photoUrl" TEXT,
ADD COLUMN "photoKey" TEXT,
ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
