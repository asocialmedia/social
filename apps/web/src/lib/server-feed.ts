import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";

import { excerpt, getPostUrl } from "@/lib/seo";

// Server-side feed helpers for SEO crawlable HTML.
// These mirror the API route logic but run via Prisma directly so
// discovery surfaces render real <a href="/posts/..."> links in SSR.

export interface CrawlPost {
  aura: number;
  content: string;
  createdAt: Date;
  id: string;
  username: string;
  displayName: string;
}

export async function getRecentPostsForCrawl(limit = 20): Promise<CrawlPost[]> {
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
    where: { isGust: false, moderated: false, user: { banned: false } },
  });

  return posts.map((p) => ({
    aura: p.aura,
    content: excerpt(p.content ?? "", 80),
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  }));
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
    where: { isGust: true, moderated: false, user: { banned: false } },
  });

  return posts.map((p) => ({
    aura: p.aura,
    content: excerpt(p.content ?? "", 80),
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  }));
}

export async function getTrendingPostsForCrawl(
  limit = 20
): Promise<CrawlPost[]> {
  // Trending ranking mirrors the API fallback: order by trendingScore desc.
  const posts = await prisma.post.findMany({
    orderBy: [{ trendingScore: "desc" }, { id: "desc" }],
    select: {
      aura: true,
      content: true,
      createdAt: true,
      id: true,
      user: { select: { displayName: true, username: true } },
    },
    take: limit,
    where: { isGust: false, moderated: false, user: { banned: false } },
  });

  return posts.map((p) => ({
    aura: p.aura,
    content: excerpt(p.content ?? "", 80),
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  }));
}

export async function getHashtagPostsForCrawl(
  tag: string,
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
      isGust: false,
      moderated: false,
      tags: { some: { name: tag } },
      user: { banned: false },
    },
  });

  return posts.map((p) => ({
    aura: p.aura,
    content: excerpt(p.content ?? "", 80),
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  }));
}

export async function getUserPostsForCrawl(
  userId: string,
  limit = 12
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
      isGust: false,
      moderated: false,
      user: { banned: false },
      userId,
    },
  });

  return posts.map((p) => ({
    aura: p.aura,
    content: excerpt(p.content ?? "", 80),
    createdAt: p.createdAt,
    displayName: p.user?.displayName ?? p.user?.username ?? "Anonymous",
    id: p.id,
    username: p.user?.username ?? "unknown",
  }));
}

// For rich SSR where the client expects full PostData (not just crawl links),
// expose a helper that returns hydrated PostData - used by home/discover
// to seed the feed's initial HTML.
export async function getRecentPostDataForCrawl(limit = 20) {
  const rows = await prisma.post.findMany({
    include: getPostDataInclude(""),
    orderBy: { createdAt: "desc" },
    take: limit,
    where: { isGust: false, moderated: false, user: { banned: false } },
  });
  return hydrateViewCounts(rows);
}

export function crawlPostHref(
  post: { content?: string | null; id: string } | string
): string {
  if (typeof post === "string") {
    return `${siteConfig.url}/posts/${post}`;
  }
  return getPostUrl(post);
}

export function gustHref(postId: string): string {
  return `${siteConfig.url}/gusts?id=${postId}`;
}
