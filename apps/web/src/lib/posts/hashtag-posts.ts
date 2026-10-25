import {
  and,
  or,
  communityVisibilityWhere,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
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
  const escaped = tag.replaceAll(/[\\%_]/g, "\\$&");
  let query = getPostDataQuery(prisma.orm, viewerId)
    .where((post) =>
      and(
        post.moderated.eq(false),
        post.rootPostId.isNull(),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere(viewerId)(post),
        ...(includeExplicit ? [] : [post.explicitContent.eq(false)]),
        or(
          post.postToTags.some((link) =>
            link.tag.some((item) => item.name.ilike(escaped))
          ),
          post.content.ilike(`%#${escaped}%`)
        )
      )
    )
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()]);
  if (cursor) {
    const anchor = await prisma.orm.public.Posts.select("createdAt")
      .where({ id: cursor })
      .first();
    if (!anchor) {
      return { nextCursor: null, posts: [] };
    }
    query = query.cursor({ createdAt: anchor.createdAt, id: cursor });
  }
  const rows = await query.limit(61).all();
  const candidates = rows.slice(0, 60);
  const posts = postsForReader(candidates.map(mapPostData), includeExplicit)
    .filter((post) => hasHashtag(post, tag))
    .slice(0, 20);
  const anchor = posts.length === 20 ? posts[19] : candidates.at(-1);
  const more =
    anchor && rows.findIndex((row) => row.id === anchor.id) < rows.length - 1;
  return {
    nextCursor: more ? anchor.id : null,
    posts: await hydrateViewCounts(posts),
  };
}

export async function getFirstPublicHashtagPage(tag: string) {
  let page = await getHashtagPostPage(tag);
  while (page.posts.length === 0 && page.nextCursor) {
    // Each page advances the keyset even when candidate hashtags do not match.
    // oxlint-disable-next-line no-await-in-loop
    page = await getHashtagPostPage(tag, "", false, page.nextCursor);
  }
  return page;
}
