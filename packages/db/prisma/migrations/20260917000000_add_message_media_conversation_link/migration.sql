-- Links message attachments to their conversation so the media serving
-- route can admit the peer via conversation membership (owner-only access
-- 404s the recipient today). Nullable: every non-message row stays NULL.
--
-- Locking: ADD COLUMN with a NULL default is metadata-only. The FK is added
-- NOT VALID so it does not scan/lock the existing table, then validated under
-- SHARE UPDATE EXCLUSIVE (concurrent reads and writes are unaffected).
--
-- The index is built CONCURRENTLY so a large `post_media` is never write-locked
-- for the duration of the build. Because PostgreSQL forbids CONCURRENTLY inside
-- a transaction block, this whole file MUST be applied outside one. This repo
-- applies schema SQL through `prisma db execute` (see docker/prisma-sync.sh),
-- which runs statements without a wrapping transaction, so the concurrent build
-- is valid here. It would NOT be valid under `prisma migrate deploy`, which
-- wraps each migration in a transaction; do not move this file to that path.
ALTER TABLE "post_media" ADD COLUMN IF NOT EXISTS "messageConversationId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'post_media_messageConversationId_fkey'
  ) THEN
    ALTER TABLE "post_media"
      ADD CONSTRAINT "post_media_messageConversationId_fkey"
      FOREIGN KEY ("messageConversationId")
      REFERENCES "message_conversations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE "post_media"
  VALIDATE CONSTRAINT "post_media_messageConversationId_fkey";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_media_messageConversationId_idx"
  ON "post_media"("messageConversationId");
