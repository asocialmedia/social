-- Versioned message conversation keys + identity backup method.
--
-- MessageConversationKey gains `version` so a member can hold more than one
-- root-key wrap for the same conversation. An identity reset (the device that
-- held the backup secret is gone) mints a fresh root and appends a new epoch,
-- while the peer's older wraps stay untouched so their history remains
-- readable. `MessageIdentity.backupMethod` records how the backup key is
-- derived (`manual-secret`, the original scheme, or `passkey-prf`).
--
-- Locking: both new columns are NOT NULL with a DEFAULT, which PostgreSQL 11+
-- applies as a metadata-only change (no table rewrite, no long lock) even on a
-- large post_media-sized table. The replacement unique index is built
-- CONCURRENTLY so writers are never blocked; the superseded index is dropped
-- only after the new one exists. Every existing row takes version = 1, and the
-- old unique index already guaranteed one row per (conversationId,
-- ownerUserId), so the new unique index cannot conflict and no row data is
-- read or lost.
--
-- Because PostgreSQL forbids CONCURRENTLY inside a transaction block, this whole
-- file MUST be applied outside one. This repo applies schema SQL through
-- `prisma db execute` (see docker/prisma-sync.sh), which does not wrap
-- statements in a transaction. It would NOT be valid under `prisma migrate
-- deploy`, which wraps each migration in a transaction; do not move this file
-- to that path. docker/prisma-sync.sh applies the same statements inline so a
-- drift-based sync works on databases that never ran this file.

ALTER TABLE "message_identities"
  ADD COLUMN IF NOT EXISTS "backupMethod" TEXT NOT NULL DEFAULT 'manual-secret';

ALTER TABLE "message_conversation_keys"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "message_conversation_keys_conversationId_ownerUserId_idx"
  ON "message_conversation_keys"("conversationId", "ownerUserId");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "message_conversation_keys_conversationId_ownerUserId_versio_key"
  ON "message_conversation_keys"("conversationId", "ownerUserId", "version");

DROP INDEX IF EXISTS "message_conversation_keys_conversationId_ownerUserId_key";
