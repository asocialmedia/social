-- Community post subscriptions plus the batched COMMUNITY_POST notification
-- they drive. The schema sync (db push) is idempotent, but the enum addition is
-- guarded here so a re-run against an already-migrated database cannot fail,
-- matching the participant_role migration.

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
-- fold count (always 1 for every other notification type).
ALTER TABLE "notifications" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "community_subscriptions" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_subscriptions_userId_createdAt_idx" ON "community_subscriptions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "community_subscriptions_communityId_idx" ON "community_subscriptions"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "community_subscriptions_communityId_userId_key" ON "community_subscriptions"("communityId", "userId");

-- CreateIndex
CREATE INDEX "notifications_recipientId_communityId_type_read_idx" ON "notifications"("recipientId", "communityId", "type", "read");

-- AddForeignKey
ALTER TABLE "community_subscriptions" ADD CONSTRAINT "community_subscriptions_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_subscriptions" ADD CONSTRAINT "community_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
