import { siteConfig } from "@asm/ui/meta/site";

import { buildSitemapIndexXml, SITEMAP_IDS } from "@/lib/seo/sitemap";

// Stable sitemap index at the URL advertised by robots.txt.
export function GET(): Response {
  // The crawler entry point must remain available when content queries fail.
  // Child sitemaps carry their entries' modification dates.
  const children = SITEMAP_IDS.map((id) => ({
    url: `${siteConfig.url}/sitemaps/${id}.xml`,
  }));

  return new Response(buildSitemapIndexXml(children), {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "content-type": "application/xml; charset=utf-8",
    },
  });
}
