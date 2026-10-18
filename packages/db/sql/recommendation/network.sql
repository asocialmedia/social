// query: network.save
UPDATE users SET "networkPreferences" = $1::jsonb,
  "networkPreferencesRevision" = "networkPreferencesRevision" + 1
WHERE id = $2 AND "networkPreferencesRevision" = $3::integer
RETURNING "networkPreferencesRevision" AS revision
// query: network.candidates
SELECT p.id FROM posts p
WHERE p."isGust" = false AND p."moderated" = false
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
