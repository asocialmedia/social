-- Community join bonus: one-time aura paid to a joiner (and a small thank-you
-- to the owner) per (community, user) pair. The unique constraint is the
-- durable anti-farm guard: leave/rejoin cannot pay twice because this row is
-- never deleted.

CREATE TABLE IF NOT EXISTS "community_join_bonuses" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinerAura" INTEGER NOT NULL,
  "ownerAura" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "community_join_bonuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "community_join_bonuses_communityId_userId_key"
  ON "community_join_bonuses"("communityId", "userId");

CREATE INDEX IF NOT EXISTS "community_join_bonuses_userId_createdAt_idx"
  ON "community_join_bonuses"("userId", "createdAt");

-- The two new aura event types. Each ADD VALUE is guarded so the migration is
-- safe to re-run and does not fail when the label already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuraType' AND e.enumlabel = 'COMMUNITY_JOIN'
  ) THEN
    ALTER TYPE "AuraType" ADD VALUE 'COMMUNITY_JOIN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuraType' AND e.enumlabel = 'COMMUNITY_JOIN_OWNER'
  ) THEN
    ALTER TYPE "AuraType" ADD VALUE 'COMMUNITY_JOIN_OWNER';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_join_bonuses_communityId_fkey'
  ) THEN
    ALTER TABLE "community_join_bonuses"
      ADD CONSTRAINT "community_join_bonuses_communityId_fkey"
      FOREIGN KEY ("communityId") REFERENCES "communities"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_join_bonuses_userId_fkey'
  ) THEN
    ALTER TABLE "community_join_bonuses"
      ADD CONSTRAINT "community_join_bonuses_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;