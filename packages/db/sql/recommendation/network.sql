// query: network.save
UPDATE users SET "networkPreferences" = $1::jsonb,
  "networkPreferencesRevision" = "networkPreferencesRevision" + 1
WHERE id = $2 AND "networkPreferencesRevision" = $3::integer
RETURNING "networkPreferencesRevision" AS revision
// query: network.candidates
SELECT p.id FROM posts p
WHERE p."isGust" = $4::boolean AND p."moderated" = false
  AND (NOT $4::boolean OR (p."rootPostId" IS NULL AND EXISTS (
    SELECT 1 FROM post_media m WHERE m."postId" = p.id AND m."type" = 'VIDEO'
  )))
  AND ($2::boolean OR p."explicitContent" = false)
  AND p."createdAt" <= NOW() + INTERVAL '1 minute'
  AND (cardinality($1::text[]) = 0 OR EXISTS (
    SELECT 1 FROM unnest($1::text[]) topic
    WHERE to_tsvector('english', p.content) @@ plainto_tsquery('english', topic)
      OR lower(topic) = ANY(COALESCE(p."semanticTags", ARRAY[]::text[]))
      OR EXISTS (SELECT 1 FROM "_PostToTag" pt JOIN "Tag" t ON t.id = pt."B"
        WHERE pt."A" = p.id AND lower(t.name) = lower(topic))
  ))
ORDER BY CASE WHEN $3 = 'trending' THEN p."trendingScore" ELSE 0 END DESC,
  p."createdAt" DESC, p.id DESC
LIMIT 180
// query: network.pagedCandidates
SELECT p.id FROM posts p
WHERE p."isGust" = $4::boolean AND p."moderated" = false
  AND (NOT $4::boolean OR (p."rootPostId" IS NULL AND EXISTS (
    SELECT 1 FROM post_media m WHERE m."postId" = p.id AND m."type" = 'VIDEO'
  )))
  AND ($2::boolean OR p."explicitContent" = false)
  AND p."createdAt" <= $6::timestamptz
  AND (cardinality($1::text[]) = 0 OR EXISTS (
    SELECT 1 FROM unnest($1::text[]) topic
    WHERE to_tsvector('english', p.content) @@ plainto_tsquery('english', topic)
      OR lower(topic) = ANY(COALESCE(p."semanticTags", ARRAY[]::text[]))
      OR EXISTS (SELECT 1 FROM "_PostToTag" pt JOIN "Tag" t ON t.id = pt."B"
        WHERE pt."A" = p.id AND lower(t.name) = lower(topic))
  ))
-- Already-served posts sort last rather than disappearing: a refresh prefers
-- unseen content, yet a small pool still fills the page instead of going blank.
-- Trending orders by heat inside both groups, because retrieving "trending" by
-- recency made the Trending and Latest tabs return the same rows.
ORDER BY (p.id = ANY($7::text[])) ASC,
  (CASE WHEN $3::text = 'trending' THEN p."trendingScore" END) DESC NULLS LAST,
  p."createdAt" DESC, p.id DESC
LIMIT 180 OFFSET $5::integer
// query: network.creators
SELECT p."userId" AS id, count(*)::float8 AS matches
FROM posts p JOIN users u ON u.id = p."userId"
WHERE p."communityId" IS NULL AND p.moderated = false
  AND ($2::boolean OR p."explicitContent" = false)
  AND p."createdAt" <= NOW() + INTERVAL '1 minute'
  AND p."userId" <> $3 AND u.banned = false
  AND NOT EXISTS (SELECT 1 FROM follows f WHERE f."followerId" = $3 AND f."followingId" = p."userId")
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b."blockerId" = $3 AND b."blockedId" = p."userId") OR (b."blockedId" = $3 AND b."blockerId" = p."userId"))
  AND EXISTS (
    SELECT 1 FROM unnest($1::text[]) topic
    WHERE to_tsvector('english', p.content) @@ plainto_tsquery('english', topic)
      OR lower(topic) = ANY(COALESCE(p."semanticTags", ARRAY[]::text[]))
      OR EXISTS (SELECT 1 FROM "_PostToTag" pt JOIN "Tag" t ON t.id = pt."B"
        WHERE pt."A" = p.id AND lower(t.name) = lower(topic))
  )
GROUP BY p."userId"
ORDER BY count(*) DESC, max(p."createdAt") DESC, p."userId" ASC
LIMIT 120
