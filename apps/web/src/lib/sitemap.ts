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
  images?: string[];
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

function renderImages(images: readonly string[] | undefined): string {
  if (!images || images.length === 0) {
    return "";
  }
  return images
    .map(
      (src) =>
        `<image:image><image:loc>${escapeXml(src)}</image:loc></image:image>`
    )
    .join("");
}

function formatW3cDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(
    ({ images, lastModified, url }) =>
      `<url><loc>${escapeXml(url)}</loc>${
        lastModified ? `<lastmod>${formatW3cDate(lastModified)}</lastmod>` : ""
      }${renderImages(images)}</url>`
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join(
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

// Gusts are public, viewable pages and their owner wants them indexed;
// moderated posts are hidden from every feed surface, so they stay out.
// Each entry carries the first previewable media image so crawlers discover
// visual content; video gets its poster frame via ?thumb=1.
async function getPostEntries(): Promise<SitemapEntry[]> {
  const posts = await prisma.post.findMany({
    include: { attachments: { where: { status: "READY" as const } } },
    orderBy: { createdAt: "desc" },
    take: SITEMAP_URL_LIMIT,
    where: {
      isGust: false,
      moderated: false,
      user: { banned: false },
    },
  });

  return posts.map((post) => {
    const preview = post.attachments.find(
      (m) =>
        m.mimeType.toLowerCase().startsWith("image/") ||
        (m as { type?: string }).type === "VIDEO"
    );
    const imageUrl = preview
      ? `${siteConfig.url}/api/media/${preview.id}${(preview as { type?: string }).type === "VIDEO" ? "?thumb=1" : ""}`
      : undefined;
    return {
      ...(imageUrl ? { images: [imageUrl] } : {}),
      lastModified: post.createdAt,
      url: `${siteConfig.url}/posts/${post.id}`,
    };
  });
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
        where: { moderated: false },
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
