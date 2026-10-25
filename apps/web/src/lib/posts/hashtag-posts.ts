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

import hashtagCandidatesSql from "./hashtag-candidates.sql" with { type: "text" };
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
    hashtagCandidatesSql,
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
