-- Links message attachments to their conversation so the media serving
-- route can admit the peer via conversation membership (owner-only access
-- 404s the recipient today). Nullable: every non-message row stays NULL.
ALTER TABLE "post_media" ADD COLUMN IF NOT EXISTS "messageConversationId" TEXT;

CREATE INDEX IF NOT EXISTS "post_media_messageConversationId_idx"
  ON "post_media"("messageConversationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'post_media_messageConversationId_fkey'
  ) THEN
    ALTER TABLE "post_media"
      ADD CONSTRAINT "post_media_messageConversationId_fkey"
      FOREIGN KEY ("messageConversationId")
      REFERENCES "message_conversations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
