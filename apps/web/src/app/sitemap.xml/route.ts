import { siteConfig } from "@asm/ui/meta/site";
import { connection } from "next/server";

import {
  buildSitemapIndexXml,
  getSitemapLastModified,
  SITEMAP_IDS,
} from "@/lib/seo/sitemap";

// Sitemap index at the exact URL robots.txt advertises (/sitemap.xml). Next's
// generateSitemaps convention does not emit an index file, which left crawlers
// facing a 404 at the one URL they were told to fetch. Each child carries a
// lastmod so crawlers can prioritize fresh content across the set.
export async function GET(): Promise<Response> {
  // lastmod comes straight from the posts table, so this is request-bound data.
  // Claiming the request also keeps the Prisma reads out of the prerender:
  // Prisma 8 stamps every query with a crypto.randomUUID() plan id, and Cache
  // Components fails a prerender that touches an uncached value.
  await connection();

  const children = await Promise.all(
    SITEMAP_IDS.map(async (id) => ({
      lastModified: await getSitemapLastModified(id),
      url: `${siteConfig.url}/sitemaps/${id}.xml`,
    }))
  );

  return new Response(buildSitemapIndexXml(children), {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "content-type": "application/xml; charset=utf-8",
    },
  });
}
