// query: topics.catalog
SELECT t.name AS topic
FROM "Tag" t
WHERE length(t.name) BETWEEN 2 AND 64
  AND ($1::text = '' OR position(lower($1::text) IN lower(t.name)) > 0)
  AND EXISTS (
    SELECT 1 FROM "_PostToTag" pt JOIN posts p ON p.id = pt."A"
    WHERE pt."B" = t.id AND p."communityId" IS NULL
      AND p.moderated = false AND p."explicitContent" = false
  )
ORDER BY t.name ASC
LIMIT 40
