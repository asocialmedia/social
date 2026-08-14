import { siteConfig } from "@asm/ui/meta/site";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const hostDomain = new URL(siteConfig.url).host;
  return {
    host: hostDomain,
    rules: [
      {
        // Public media is streamed through app proxy routes (the buckets are
        // private), so those paths stay crawlable for OG images.
        allow: ["/api/media/", "/api/users/avatar/", "/api/users/banner/"],
        // Account-scoped areas redirect to /login for guests; blocking them
        // keeps crawler budget focused on indexable, public content.
        disallow: [
          "/api/",
          "/settings",
          "/bookmarks",
          "/notifications",
          "/soon",
        ],
        userAgent: "*",
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
