import { prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { MetadataRoute } from "next";
import { cacheLife } from "next/cache";

// Regenerate the sitemap at most once an hour; the lists are large and don't
// need to be recomputed on every crawler hit. cacheLife replaces the old
// `export const revalidate` under Cache Components.
const CORE_PATHS = [
  "",
  "/discover",
  "/hackernews",
  "/login",
  "/signup",
] as const;

export function generateSitemaps() {
  return [{ id: "core" }, { id: "posts" }, { id: "users" }, { id: "tags" }];
}

export default async function sitemap({
  id,
}: {
  id: string;
}): Promise<MetadataRoute.Sitemap> {
  "use cache";
  cacheLife("hours");

  const base = siteConfig.url;

  switch (id) {
    case "posts": {
      const posts = await prisma.post.findMany({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, id: true },
        take: 20_000,
        where: { user: { banned: false } },
      });
      return posts.map((post) => ({
        lastModified: post.createdAt,
        url: `${base}/posts/${post.id}`,
      }));
    }
    case "users": {
      const users = await prisma.user.findMany({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true, username: true },
        take: 20_000,
        where: { banned: false },
      });
      return users.map((user) => ({
        lastModified: user.updatedAt,
        url: `${base}/users/${user.username}`,
      }));
    }
    case "tags": {
      const tags = await prisma.tag.findMany({
        orderBy: { updatedAt: "desc" },
        select: { name: true, updatedAt: true },
        take: 20_000,
      });
      return tags.map((tag) => ({
        lastModified: tag.updatedAt,
        url: `${base}/hashtag/${encodeURIComponent(tag.name)}`,
      }));
    }
    default: {
      return CORE_PATHS.map((path) => ({
        url: `${base}${path}`,
      }));
    }
  }
}
