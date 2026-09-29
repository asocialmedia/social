-- Delete-for-me hides and delivery watermarks.
--
-- `message_hidden` backs "delete for me": a per-user hide of a message that
-- leaves the peer's copy untouched. It has to be a join table rather than a
-- column because the same message is visible to one member and hidden from the
-- other. The composite primary key gives the "one hide per (message, user)"
-- invariant for free, and the `userId` index serves the hot filter
-- (`hidden: { none: { userId } }`) on the thread, list, and badge queries.
-- Both FKs cascade so a purged message or account cannot strand rows.
--
-- `lastDeliveredAt` on the conversation member is a delivery watermark: the
-- createdAt of the newest message that member has confirmed receipt of. It lets
-- a sender label each of its own messages Delivered without a per-message
-- receipt row (the `lastReadAt` column already provided the read watermark and
-- the same shape). Null means never acked, so pre-feature history claims
-- nothing. Both changes are purely additive: a new table and one nullable
-- timestamp column. Adding a NULL-default column is a metadata-only change in
-- PostgreSQL even on a large table, so no rewrite or long lock.

CREATE TABLE IF NOT EXISTS "message_hidden" (
  "messageId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_hidden_pkey" PRIMARY KEY ("messageId", "userId")
);

CREATE INDEX IF NOT EXISTS "message_hidden_userId_idx"
  ON "message_hidden" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_hidden_messageId_fkey'
  ) THEN
    ALTER TABLE "message_hidden"
      ADD CONSTRAINT "message_hidden_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "messages" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_hidden_userId_fkey'
  ) THEN
    ALTER TABLE "message_hidden"
      ADD CONSTRAINT "message_hidden_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "message_conversation_members"
  ADD COLUMN IF NOT EXISTS "lastDeliveredAt" TIMESTAMP(3);
