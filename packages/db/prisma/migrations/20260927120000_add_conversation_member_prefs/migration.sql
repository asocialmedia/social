-- Per-member DM preferences: mute + chat theme.
--
-- Both live on `message_conversation_members`, which is the member row of a 1:1
-- pair (every message conversation is keyed by `pairKey` and has exactly two
-- members), so they are DM-scoped by construction and each participant keeps
-- their own copy. That is the point: muting a chat and picking its theme are
-- personal preferences, and neither should be visible to, or editable by, the
-- person on the other side.
--
-- `mutedAt` is a timestamp rather than a boolean so a mute is a real event. The
-- unread badge is suppressed per member by filtering on it, and a null means
-- "never muted". `themeKey` is a nullable key into the client-side theme table;
-- null resolves to the app default, so a new theme needs no backfill and an
-- unknown key degrades to the default instead of rendering nothing.
--
-- Both are nullable columns added to an existing table, which PostgreSQL treats
-- as a metadata-only change: no rewrite, no long lock, and every existing row
-- reads back as "unmuted, default theme" without backfill.

ALTER TABLE "message_conversation_members"
  ADD COLUMN IF NOT EXISTS "mutedAt" TIMESTAMP(3);

ALTER TABLE "message_conversation_members"
  ADD COLUMN IF NOT EXISTS "themeKey" TEXT;

-- The unread-count seed now skips muted memberships, so it filters this table by
-- (userId, mutedAt); the leading `userId` matches the existing `userId` index so
-- this only widens it.
CREATE INDEX IF NOT EXISTS "message_conversation_members_userId_mutedAt_idx"
  ON "message_conversation_members" ("userId", "mutedAt");
