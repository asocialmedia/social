-- Audit cleanup: remove junk accounts created by unauthenticated signup
-- abuse before the email-validation gate was added (2026-08-21).
--
-- The three accounts below were created during the audit's live testing.
-- They are unverified and inert, but should not sit in the database.
--
-- Run against the production Postgres (e.g. via Dokploy console or psql):
--   psql "$DATABASE_URL" -f scripts/security-cleanup.sql

BEGIN;

DELETE FROM "user"
WHERE "email" IN (
  'spam1787295195036-1@example.com',
  'spam1787295195036-2@example.com',
  'spam1787295195036-3@example.com'
);

-- Sweep any other never-verified example.com signups older than a week that
-- have no sessions and no posts (adjust to taste before running).
DELETE FROM "user" u
WHERE u."email" LIKE '%@example.com'
  AND u."emailVerified" = false
  AND u."createdAt" < now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM "session" s WHERE s."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "post" p WHERE p."userId" = u."id");

COMMIT;
