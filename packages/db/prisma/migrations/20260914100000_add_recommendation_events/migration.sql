CREATE TABLE IF NOT EXISTS "recommendation_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "durationMs" INTEGER,
  "dedupeKey" TEXT,
  "value" DOUBLE PRECISION,
  "sessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recommendation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "recommendation_events_userId_eventType_createdAt_idx"
  ON "recommendation_events"("userId", "eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "recommendation_events_postId_eventType_createdAt_idx"
  ON "recommendation_events"("postId", "eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "recommendation_events_userId_postId_createdAt_idx"
  ON "recommendation_events"("userId", "postId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "recommendation_events_dedupeKey_key"
  ON "recommendation_events"("dedupeKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_events_userId_fkey'
  ) THEN
    ALTER TABLE "recommendation_events"
      ADD CONSTRAINT "recommendation_events_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_events_postId_fkey'
  ) THEN
    ALTER TABLE "recommendation_events"
      ADD CONSTRAINT "recommendation_events_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "posts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
