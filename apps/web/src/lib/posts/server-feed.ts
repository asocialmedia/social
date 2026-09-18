import {
  communityVisibilityWhere,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";

import { excerpt, getPostUrl, getShortPostId } from "@/lib/seo/seo";

// Server-side feed helpers for SEO crawlable HTML.
// These mirror the API route logic but run via Prisma directly so
// discovery surfaces render real <a href="/posts/..."> links in SSR.

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
const CRAWL_POST_SELECT = {
  aura: true,
  community: { select: { slug: true } },
  content: true,
  createdAt: true,
  id: true,
  user: { select: { displayName: true, username: true } },
} as const;

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
    content: excerpt(p.content ?? "", 80),
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  };
}

export async function getRecentPostsForCrawl(limit = 20): Promise<CrawlPost[]> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: CRAWL_POST_SELECT,
    take: limit,
    where: {
      isGust: false,
      moderated: false,
      rootPostId: null,
      user: { banned: false },
      ...communityVisibilityWhere(""),
    },
  });

  return posts.map(toCrawlPost);
}

export async function getRecentGustsForCrawl(limit = 12): Promise<CrawlPost[]> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      aura: true,
      content: true,
      createdAt: true,
      id: true,
      user: { select: { displayName: true, username: true } },
    },
    take: limit,
    where: {
      isGust: true,
      moderated: false,
      user: { banned: false },
      ...communityVisibilityWhere(""),
    },
  });

  return posts.map((p) => ({
    ...toCrawlPost({ ...p, community: null }),
  }));
}

export async function getTrendingPostsForCrawl(
  limit = 20
): Promise<CrawlPost[]> {
  // Trending ranking mirrors the API fallback: order by trendingScore desc.
  const posts = await prisma.post.findMany({
    orderBy: [{ trendingScore: "desc" }, { id: "desc" }],
    select: CRAWL_POST_SELECT,
    take: limit,
    where: {
      isGust: false,
      moderated: false,
      rootPostId: null,
      user: { banned: false },
      ...communityVisibilityWhere(""),
    },
  });

  return posts.map(toCrawlPost);
}

export async function getHashtagPostsForCrawl(
  tag: string,
  limit = 20
): Promise<CrawlPost[]> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: CRAWL_POST_SELECT,
    take: limit,
    where: {
      isGust: false,
      moderated: false,
      rootPostId: null,
      tags: { some: { name: tag } },
      user: { banned: false },
      ...communityVisibilityWhere(""),
    },
  });

  return posts.map(toCrawlPost);
}

export async function getUserPostsForCrawl(
  userId: string,
  limit = 12
): Promise<CrawlPost[]> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: CRAWL_POST_SELECT,
    take: limit,
    where: {
      isGust: false,
      moderated: false,
      rootPostId: null,
      user: { banned: false },
      userId,
      ...communityVisibilityWhere(""),
    },
  });

  return posts.map(toCrawlPost);
}

// For rich SSR where the client expects full PostData (not just crawl links),
// expose a helper that returns hydrated PostData - used by home/discover
// to seed the feed's initial HTML.
export async function getRecentPostDataForCrawl(limit = 20) {
  const rows = await prisma.post.findMany({
    include: getPostDataInclude(""),
    orderBy: { createdAt: "desc" },
    take: limit,
    where: {
      isGust: false,
      moderated: false,
      rootPostId: null,
      user: { banned: false },
      ...communityVisibilityWhere(""),
    },
  });
  return hydrateViewCounts(rows);
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
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      aura: true,
      content: true,
      createdAt: true,
      id: true,
      user: { select: { displayName: true, username: true } },
    },
    take: limit,
    where: {
      communityId: community.id,
      isGust: false,
      moderated: false,
      user: { banned: false },
    },
  });

  return posts.map((p) =>
    toCrawlPost({ ...p, community: { slug: community.slug } })
  );
}

export function gustHref(postId: string): string {
  return `${siteConfig.url}/gusts?id=${postId}`;
}
