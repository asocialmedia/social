import { prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";

import { excerpt } from "@/lib/seo";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toRfc822(date: Date): string {
  return date.toUTCString();
}

export async function GET(): Promise<Response> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      content: true,
      createdAt: true,
      id: true,
      tags: { select: { name: true } },
      user: { select: { displayName: true, username: true } },
    },
    take: 50,
    where: { moderated: false, user: { banned: false } },
  });

  const items = posts
    .map((post) => {
      const title = `${post.user.displayName || post.user.username} (@${post.user.username}): ${excerpt(post.content, 72)}`;
      const description = excerpt(post.content, 220);
      const link = `${siteConfig.url}/posts/${post.id}`;
      const categories = post.tags.map((tag) => tag.name);

      return [
        "    <item>",
        `      <title>${escapeXml(title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <description>${escapeXml(description)}</description>`,
        ...categories.map(
          (cat) => `      <category>${escapeXml(cat)}</category>`
        ),
        `      <pubDate>${escapeXml(toRfc822(post.createdAt))}</pubDate>`,
        `      <author>${escapeXml(`${post.user.username}@asocialmedia.cc (${post.user.displayName || post.user.username})`)}</author>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(siteConfig.name)}</title>`,
    `    <link>${escapeXml(siteConfig.url)}</link>`,
    `    <description>${escapeXml(siteConfig.description)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${escapeXml(toRfc822(new Date()))}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(`${siteConfig.url}/feed.xml`)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      "content-type": "application/rss+xml; charset=utf-8",
    },
  });
}
