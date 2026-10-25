import {
  and,
  communityVisibilityWhere,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
  rawQuery,
} from "@asm/db";
import { hasHashtag, normalizeHashtag } from "@asm/protocols/discovery";

import { postsForReader } from "./reader-content-policy";

export async function getHashtagPostPage(
  rawTag: string,
  viewerId = "",
  includeExplicit = false,
  cursor?: string
) {
  const tag = normalizeHashtag(rawTag);
  if (!tag) {
    throw new Error("Invalid hashtag");
  }
  // PostgreSQL's Unicode collation handles existing text even on C-locale databases.
  // Match complete tokens before hydrating relations; values stay bound parameters.
  const candidates = await rawQuery<{ id: string }>(
    `
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
  `,
    [
      tag,
      `(^|[^[:alnum:]_])#${tag}($|[^[:alnum:]_-])`,
      viewerId,
      includeExplicit,
      cursor ?? null,
    ],
    { id: "pg/text@1" }
  );
  const query = getPostDataQuery(prisma.orm, viewerId)
    .where((post) =>
      and(
        post.id.in(candidates.rows.map((row) => row.id)),
        post.moderated.eq(false),
        post.rootPostId.isNull(),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere(viewerId)(post),
        ...(includeExplicit ? [] : [post.explicitContent.eq(false)])
      )
    )
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()]);
  const rows = await query.limit(61).all();
  const window = rows.slice(0, 60);
  const posts = postsForReader(window.map(mapPostData), includeExplicit)
    .filter((post) => hasHashtag(post, tag))
    .slice(0, 20);
  const anchor = posts.length === 20 ? posts[19] : window.at(-1);
  const more =
    anchor && rows.findIndex((row) => row.id === anchor.id) < rows.length - 1;
  return {
    nextCursor: more ? anchor.id : null,
    posts: await hydrateViewCounts(posts),
  };
}

export async function getFirstPublicHashtagPage(tag: string) {
  let page = await getHashtagPostPage(tag);
  for (
    let scannedPages = 1;
    scannedPages < 3 && page.posts.length === 0 && page.nextCursor;
    scannedPages += 1
  ) {
    // Bound server work; the client continues from the returned keyset when needed.
    // oxlint-disable-next-line no-await-in-loop
    page = await getHashtagPostPage(tag, "", false, page.nextCursor);
  }
  return page;
}
