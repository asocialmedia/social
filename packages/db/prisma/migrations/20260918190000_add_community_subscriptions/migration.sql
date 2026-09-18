-- Community post subscriptions plus the batched COMMUNITY_POST notification
-- they drive.
--
-- Locking: `notifications` can be large, so its new index is built CONCURRENTLY
-- and its foreign key is added NOT VALID then validated (a validation scan
-- takes only SHARE UPDATE EXCLUSIVE). `community_subscriptions` is a brand-new
-- empty table, so its own indexes and foreign keys are built plainly.
--
-- Because PostgreSQL forbids CONCURRENTLY inside a transaction block, this whole
-- file MUST be applied outside one. This repo applies schema SQL through
-- `prisma db execute` (see docker/prisma-sync.sh), which does not wrap
-- statements in a transaction. It would NOT be valid under `prisma migrate
-- deploy`, which wraps each migration in a transaction; do not move this file
-- to that path.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'COMMUNITY_POST'
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'COMMUNITY_POST' BEFORE 'FOLLOW';
  END IF;
END $$;

-- AlterTable: the batched community notification carries its community and a
-- fold count (always 1 for every other notification type). Both ADD COLUMNs are
-- metadata-only on PostgreSQL.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "communityId" TEXT,
ADD COLUMN IF NOT EXISTS "count" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE IF NOT EXISTS "community_subscriptions" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (new, empty table - no lock to avoid)
CREATE INDEX IF NOT EXISTS "community_subscriptions_userId_createdAt_idx" ON "community_subscriptions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "community_subscriptions_communityId_idx" ON "community_subscriptions"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "community_subscriptions_communityId_userId_key" ON "community_subscriptions"("communityId", "userId");

-- CreateIndex on the existing, possibly large notifications table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_recipientId_communityId_type_read_idx" ON "notifications"("recipientId", "communityId", "type", "read");

-- AddForeignKey (new, empty table)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_subscriptions_communityId_fkey'
  ) THEN
    ALTER TABLE "community_subscriptions" ADD CONSTRAINT "community_subscriptions_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_subscriptions_userId_fkey'
  ) THEN
    ALTER TABLE "community_subscriptions" ADD CONSTRAINT "community_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey on the existing notifications table, NOT VALID so it does not
-- scan/lock the table while being added, then validated under SHARE UPDATE
-- EXCLUSIVE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_communityId_fkey'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_communityId_fkey"
      FOREIGN KEY ("communityId")
      REFERENCES "communities"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_communityId_fkey";
