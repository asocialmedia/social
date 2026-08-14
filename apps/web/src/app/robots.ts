import { siteConfig } from "@asm/ui/meta/site";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    host: siteConfig.url,
    rules: [
      {
        allow: "/",
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
