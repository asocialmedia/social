// query: follows.lock
SELECT pg_advisory_xact_lock(hashtextextended('external-follows-registry-v1', 0))
// query: follows.prune
DELETE FROM external_authors a WHERE NOT EXISTS (SELECT 1 FROM external_follows f WHERE f."authorDid" = a.did)
// query: follows.scrub
UPDATE external_posts SET snapshot = NULL, available = false, "checkedAt" = now() WHERE "authorId" = $1
