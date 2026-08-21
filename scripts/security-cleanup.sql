-- Audit cleanup: remove junk accounts created by unauthenticated signup
-- abuse before the email-validation gate was added (2026-08-21).
--
-- The three accounts below were created during the audit's live testing.
-- They are unverified and inert, but should not sit in the database.
--
-- Run against the production Postgres (e.g. via Dokploy console or psql):
--   psql "$DATABASE_URL" -f scripts/security-cleanup.sql

BEGIN;

DELETE FROM "users"
WHERE "email" IN (
  'spam1787295195036-1@example.com',
  'spam1787295195036-2@example.com',
  'spam1787295195036-3@example.com'
);

-- Reviewed-ID sweep: first materialize the candidate ids into a temp table
-- that can be inspected (SELECT * FROM pending_user_ids;) before the DELETE
-- runs. The final delete is restricted to exactly those reviewed ids, and a
-- candidate is only swept when it has NO user-owned relations at all, so a
-- real account that happens to match the email pattern is never auto-removed.
CREATE TEMP TABLE pending_user_ids AS
SELECT u."id"
FROM "users" u
WHERE u."email" LIKE '%@example.com'
  AND u."emailVerified" = false
  AND u."createdAt" < now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM "sessions" s WHERE s."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "posts" p WHERE p."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "comments" c WHERE c."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "post_media" m WHERE m."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "votes" v WHERE v."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "notifications" n WHERE n."recipientId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "aura_logs" a WHERE a."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "follows" f WHERE f."followerId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "follows" f WHERE f."followingId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "blocks" b WHERE b."blockerId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "blocks" b WHERE b."blockedId" = u."id");

-- Inspect the pending ids here before deleting:
--   SELECT * FROM pending_user_ids;

DELETE FROM "users" u
WHERE u."id" IN (SELECT "id" FROM pending_user_ids);

COMMIT;
