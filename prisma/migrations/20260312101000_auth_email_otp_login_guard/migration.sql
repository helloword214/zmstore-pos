-- CreateEnum
CREATE TYPE "LoginRateLimitScope" AS ENUM ('IP', 'EMAIL');

-- CreateTable
CREATE TABLE "LoginOtpChallenge" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestedIp" VARCHAR(64),
    "requestedUserAgent" VARCHAR(300),
    "consumedIp" VARCHAR(64),
    "consumedUserAgent" VARCHAR(300),

    CONSTRAINT "LoginOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginRateLimitState" (
    "id" SERIAL NOT NULL,
    "scope" "LoginRateLimitScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailedAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "blockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginRateLimitState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginOtpChallenge_userId_createdAt_idx" ON "LoginOtpChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginOtpChallenge_expiresAt_idx" ON "LoginOtpChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginOtpChallenge_consumedAt_idx" ON "LoginOtpChallenge"("consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginRateLimitState_scope_scopeKey_key" ON "LoginRateLimitState"("scope", "scopeKey");

-- CreateIndex
CREATE INDEX "LoginRateLimitState_blockedUntil_idx" ON "LoginRateLimitState"("blockedUntil");

-- AddForeignKey
ALTER TABLE "LoginOtpChallenge" ADD CONSTRAINT "LoginOtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
