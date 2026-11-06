import {
  and,
  communityVisibilityWhere,
  fromPrismaDateTime,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";

import { publicPostReadable } from "@/lib/seo/public-post-readability";
import { getPostUrl, getShortPostId } from "@/lib/seo/seo";

import { postsForReader } from "./reader-content-policy";

// Server-side feed helpers for SEO crawlable HTML.
// These mirror the API route logic but run via Prisma directly so
// discovery surfaces render real <a href="/posts/..."> links in SSR.
// Every helper is guest-rendered, so explicit posts are excluded unconditionally:
// a crawler has no session and can never opt in.

export interface CrawlPost {
  aura: number;
  // The owning community, so a community post's crawlable link is its canonical
  // /a/<slug>/posts/... address instead of a /posts/... URL that only redirects.
  community?: { slug: string } | null;
  content: string;
  createdAt: Date;
  id: string;
  username: string;
  displayName: string;
}

// Shared projection for the non-gust crawl queries: the fields the CrawlPost
// shape needs, plus the community slug for canonical links.
function toCrawlPost(p: {
  aura: number;
  community: { slug: string } | null;
  content: string | null;
  createdAt: Date;
  id: string;
  user: { displayName: string | null; username: string } | null;
}): CrawlPost {
  return {
    aura: p.aura,
    community: p.community,
    content: p.content ?? "",
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  };
}

export async function getRecentPostsForCrawl(limit = 20): Promise<CrawlPost[]> {
  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "semanticTags",
    "embeds",
    "id"
  )
    .include("postMedias", (media) => media.select("altText"))
    .include("postToTags", (links) =>
      links.include("tag", (item) => item.select("name"))
    )
    .include("community", (community) => community.select("slug"))
    .include("user", (user) => user.select("displayName", "username"))
    .where((post) =>
      and(
        post.isGust.eq(false),
        post.moderated.eq(false),
        post.explicitContent.eq(false),
        post.rootPostId.isNull(),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere("")(post)
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();

  return posts.filter(publicPostReadable).map((post) =>
    toCrawlPost({
      ...post,
      createdAt: fromPrismaDateTime(post.createdAt),
    })
  );
}

export async function getRecentGustsForCrawl(limit = 12): Promise<CrawlPost[]> {
  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "semanticTags",
    "embeds",
    "id"
  )
    .include("postMedias", (media) => media.select("altText"))
    .include("postToTags", (links) =>
      links.include("tag", (item) => item.select("name"))
    )
    .include("user", (user) => user.select("displayName", "username"))
    .where((post) =>
      and(
        post.isGust.eq(true),
        post.moderated.eq(false),
        post.explicitContent.eq(false),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere("")(post)
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();

  return posts.filter(publicPostReadable).map((post) =>
    toCrawlPost({
      ...post,
      community: null,
      createdAt: fromPrismaDateTime(post.createdAt),
    })
  );
}

export async function getTrendingPostsForCrawl(
  limit = 20
): Promise<CrawlPost[]> {
  // Trending ranking mirrors the API fallback: order by trendingScore desc.
  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "semanticTags",
    "embeds",
    "id"
  )
    .include("postMedias", (media) => media.select("altText"))
    .include("postToTags", (links) =>
      links.include("tag", (item) => item.select("name"))
    )
    .include("community", (community) => community.select("slug"))
    .include("user", (user) => user.select("displayName", "username"))
    .where((post) =>
      and(
        post.isGust.eq(false),
        post.moderated.eq(false),
        post.explicitContent.eq(false),
        post.rootPostId.isNull(),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere("")(post)
      )
    )
    .orderBy([(post) => post.trendingScore.desc(), (post) => post.id.desc()])
    .limit(limit)
    .all();

  return posts.filter(publicPostReadable).map((post) =>
    toCrawlPost({
      ...post,
      createdAt: fromPrismaDateTime(post.createdAt),
    })
  );
}

export async function getHashtagPostsForCrawl(
  tag: string,
  limit = 20
): Promise<CrawlPost[]> {
  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "semanticTags",
    "embeds",
    "id"
  )
    .include("postMedias", (media) => media.select("altText"))
    .include("postToTags", (links) =>
      links.include("tag", (item) => item.select("name"))
    )
    .include("community", (community) => community.select("slug"))
    .include("user", (user) => user.select("displayName", "username"))
    .where((post) =>
      and(
        post.isGust.eq(false),
        post.moderated.eq(false),
        post.explicitContent.eq(false),
        post.rootPostId.isNull(),
        post.postToTags.some((postTag) =>
          postTag.tag.some((tagRecord) => tagRecord.name.eq(tag))
        ),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere("")(post)
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();

  return posts.filter(publicPostReadable).map((post) =>
    toCrawlPost({
      ...post,
      createdAt: fromPrismaDateTime(post.createdAt),
    })
  );
}

export async function getUserPostsForCrawl(
  userId: string,
  limit = 12
): Promise<CrawlPost[]> {
  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "semanticTags",
    "embeds",
    "id"
  )
    .include("postMedias", (media) => media.select("altText"))
    .include("postToTags", (links) =>
      links.include("tag", (item) => item.select("name"))
    )
    .include("community", (community) => community.select("slug"))
    .include("user", (user) => user.select("displayName", "username"))
    .where((post) =>
      and(
        post.isGust.eq(false),
        post.moderated.eq(false),
        post.explicitContent.eq(false),
        post.rootPostId.isNull(),
        post.userId.eq(userId),
        post.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere("")(post)
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();

  return posts.filter(publicPostReadable).map((post) =>
    toCrawlPost({
      ...post,
      createdAt: fromPrismaDateTime(post.createdAt),
    })
  );
}

// For rich SSR where the client expects full PostData (not just crawl links),
// expose a helper that returns hydrated PostData - used by home/discover
// to seed the feed's initial HTML.
export async function getRecentPostDataForCrawl(
  limit = 20,
  filter: { userId?: string; tag?: string } = {}
) {
  let query = getPostDataQuery(prisma.orm, "").where((post) =>
    and(
      post.isGust.eq(false),
      post.moderated.eq(false),
      post.explicitContent.eq(false),
      post.rootPostId.isNull(),
      post.user.some((user) => user.banned.eq(false)),
      communityVisibilityWhere("")(post)
    )
  );
  if (filter.userId) {
    query = query.where({ userId: filter.userId });
  }
  if (filter.tag) {
    const { tag } = filter;
    query = query.where((post) =>
      post.postToTags.some((link) => link.tag.some((item) => item.name.eq(tag)))
    );
  }
  const rows = await query
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()])
    .limit(limit)
    .all();
  return hydrateViewCounts(postsForReader(rows.map(mapPostData), false));
}

export function crawlPostHref(
  post: { content?: string | null; id: string } | string
): string {
  if (typeof post === "string") {
    const shortId = getShortPostId(post);
    return `${siteConfig.url}/posts/${shortId}`;
  }
  return getPostUrl(post);
}

// Posts published into one community, projected for a crawlable link list on
// the community page. The community slug rides along so each href is the
// post's canonical /a/<slug>/posts/... address.
export async function getCommunityPostsForCrawl(
  community: { id: string; slug: string },
  limit = 20
): Promise<CrawlPost[]> {
  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "semanticTags",
    "embeds",
    "id"
  )
    .include("postMedias", (media) => media.select("altText"))
    .include("postToTags", (links) =>
      links.include("tag", (item) => item.select("name"))
    )
    .include("user", (user) => user.select("displayName", "username"))
    .where((post) =>
      and(
        post.communityId.eq(community.id),
        post.isGust.eq(false),
        post.moderated.eq(false),
        post.explicitContent.eq(false),
        post.user.some((user) => user.banned.eq(false))
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();

  return posts.filter(publicPostReadable).map((post) =>
    toCrawlPost({
      ...post,
      community: { slug: community.slug },
      createdAt: fromPrismaDateTime(post.createdAt),
    })
  );
}

export function gustHref(postId: string): string {
  return `${siteConfig.url}/gusts?id=${postId}`;
}
