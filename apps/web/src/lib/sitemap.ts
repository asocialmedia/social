import { prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";

// Sitemap architecture
// ────────────────────
// /sitemap.xml        → sitemap index listing every child below (route handler)
// /sitemaps/core.xml  → hand-picked public pages
// /sitemaps/posts.xml → latest public posts
// /sitemaps/users.xml → active user profiles
// /sitemaps/tags.xml  → hashtag pages
//
// The old file-convention sitemap (app/sitemap.ts + generateSitemaps) served
// the core URL list for EVERY child because Next passes the array index as
// the id prop rather than the declared string id, so no switch case ever
// matched and crawlers never saw a single post or profile URL. Plain route
// handlers own the whole pipeline now: the id comes from the URL segment and
// the index at /sitemap.xml is emitted explicitly, which robots.txt has been
// promising all along.

export const SITEMAP_IDS = ["core", "posts", "users", "tags"] as const;

export type SitemapId = (typeof SITEMAP_IDS)[number];

export function isSitemapId(value: string): value is SitemapId {
  return (SITEMAP_IDS as readonly string[]).includes(value);
}

const SITEMAP_URL_LIMIT = 20_000;

export interface SitemapEntry {
  lastModified?: Date;
  url: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatW3cDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(
    ({ lastModified, url }) =>
      `<url><loc>${escapeXml(url)}</loc>${
        lastModified ? `<lastmod>${formatW3cDate(lastModified)}</lastmod>` : ""
      }</url>`
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join(
      ""
    )}</urlset>`
  );
}

export function buildSitemapIndexXml(entries: SitemapEntry[]): string {
  const children = entries
    .map(
      ({ lastModified, url }) =>
        `<sitemap><loc>${escapeXml(url)}</loc>${
          lastModified
            ? `<lastmod>${formatW3cDate(lastModified)}</lastmod>`
            : ""
        }</sitemap>`
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
      children
    }</sitemapindex>`
  );
}

// Hand-picked crawlable public pages. Login, signup, and HackerNews are
// deliberately absent: auth pages are noindexed and HackerNews redirects
// guests to login, so listing them only burns crawl budget.
const CORE_PATHS = ["", "/discover"] as const;

// oxlint-disable-next-line require-await -- kept async for Promise-return consistency with DB-backed siblings
async function getCoreEntries(): Promise<SitemapEntry[]> {
  return CORE_PATHS.map((path) => ({
    url: `${siteConfig.url}${path}`,
  }));
}

// Mirrors the public global-feed filter (see api/posts/for-you): gusts and
// moderated posts never appear in a feed, so they must not appear in the
// sitemap either.
async function getPostEntries(): Promise<SitemapEntry[]> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, id: true },
    take: SITEMAP_URL_LIMIT,
    where: {
      isGust: false,
      moderated: false,
      user: { banned: false },
    },
  });

  return posts.map((post) => ({
    lastModified: post.createdAt,
    url: `${siteConfig.url}/posts/${post.id}`,
  }));
}

async function getUserEntries(): Promise<SitemapEntry[]> {
  const users = await prisma.user.findMany({
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true, username: true },
    take: SITEMAP_URL_LIMIT,
    where: { banned: false },
  });

  return users.map((user) => ({
    lastModified: user.updatedAt,
    url: `${siteConfig.url}/users/${user.username}`,
  }));
}

async function getTagEntries(): Promise<SitemapEntry[]> {
  const tags = await prisma.tag.findMany({
    orderBy: { updatedAt: "desc" },
    select: { name: true, updatedAt: true },
    take: SITEMAP_URL_LIMIT,
  });

  return tags.map((tag) => ({
    lastModified: tag.updatedAt,
    url: `${siteConfig.url}/hashtag/${encodeURIComponent(tag.name)}`,
  }));
}

export function getSitemapEntries(id: SitemapId): Promise<SitemapEntry[]> {
  switch (id) {
    case "posts": {
      return getPostEntries();
    }
    case "tags": {
      return getTagEntries();
    }
    case "users": {
      return getUserEntries();
    }
    default: {
      return getCoreEntries();
    }
  }
}

export async function getSitemapLastModified(
  id: SitemapId
): Promise<Date | undefined> {
  switch (id) {
    case "posts": {
      const latest = await prisma.post.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
        where: { isGust: false, moderated: false },
      });
      return latest?.createdAt;
    }
    case "users": {
      const [latest] = await prisma.user.findMany({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
        take: 1,
      });
      return latest?.updatedAt;
    }
    case "tags": {
      const [latest] = await prisma.tag.findMany({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
        take: 1,
      });
      return latest?.updatedAt;
    }
    default: {
      return undefined;
    }
  }
}
