SELECT p.id FROM posts p
WHERE p.moderated = false AND p."rootPostId" IS NULL
  AND ($4::boolean OR p."explicitContent" = false)
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = p."userId" AND u.banned = false)
  AND (
    (p."communityId" IS NULL AND NOT EXISTS (
      SELECT 1 FROM community_post_shares s WHERE s."postId" = p.id
    ))
    OR EXISTS (
      SELECT 1 FROM communities c WHERE c.id = p."communityId" AND (
        c.type <> 'PRIVATE' OR ($3 <> '' AND EXISTS (
          SELECT 1 FROM community_members m
          WHERE m."communityId" = c.id AND m."userId" = $3 AND m.status = 'ACTIVE'
        ))
      )
    )
    OR EXISTS (
      SELECT 1 FROM community_post_shares s JOIN communities c ON c.id = s."communityId"
      WHERE s."postId" = p.id AND (
        c.type <> 'PRIVATE' OR ($3 <> '' AND EXISTS (
          SELECT 1 FROM community_members m
          WHERE m."communityId" = c.id AND m."userId" = $3 AND m.status = 'ACTIVE'
        ))
      )
    )
  )
  AND ($5::text IS NULL OR (p."createdAt", p.id) < (
    SELECT a."createdAt", a.id FROM posts a WHERE a.id = $5
  ))
  AND (
    lower(normalize(p.content, NFC) COLLATE pg_catalog.pg_c_utf8) ~ $2
    OR EXISTS (
      SELECT 1 FROM "_PostToTag" l JOIN "Tag" t ON t.id = l."B"
      WHERE l."A" = p.id
        AND lower(normalize(t.name, NFC) COLLATE pg_catalog.pg_c_utf8) = $1
    )
  )
ORDER BY p."createdAt" DESC, p.id DESC LIMIT 61
