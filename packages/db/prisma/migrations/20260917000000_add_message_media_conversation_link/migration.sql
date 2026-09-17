-- Links message attachments to their conversation so the media serving
-- route can admit the peer via conversation membership (owner-only access
-- 404s the recipient today). Nullable: every non-message row stays NULL.
--
-- Locking: ADD COLUMN with a NULL default is metadata-only. The FK is added
-- NOT VALID so it does not scan/lock the existing table, then validated under
-- SHARE UPDATE EXCLUSIVE (concurrent reads and writes are unaffected). The
-- index is built last; on a very large `post_media` in production, run the
-- CREATE INDEX CONCURRENTLY variant out of band instead (it cannot run inside
-- a migration transaction).
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

CREATE INDEX IF NOT EXISTS "post_media_messageConversationId_idx"
  ON "post_media"("messageConversationId");
