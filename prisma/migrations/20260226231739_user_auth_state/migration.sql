-- CreateEnum
CREATE TYPE "UserAuthState" AS ENUM ('PENDING_PASSWORD', 'ACTIVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authState" "UserAuthState" NOT NULL DEFAULT 'ACTIVE';
