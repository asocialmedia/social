import { siteConfig } from "@asm/ui/meta/site";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const hostDomain = new URL(siteConfig.url).host;
  return {
    host: hostDomain,
    rules: [
      {
        // Public media is streamed through app proxy routes (the buckets are
        // private), so those paths stay crawlable for OG and avatar images.
        allow: [
          "/api/media/",
          "/api/users/avatar/",
          "/api/users/banner/",
          "/api/communities/avatar/",
          "/api/communities/banner/",
          "/api/link-preview/image",
        ],
        // Account-scoped, private, and internal search routes are disallowed
        // to keep crawler budget focused on indexable public content.
        // Auth pages remain crawlable so their noindex metadata can be read.
        disallow: [
          "/api/",
          "/messages",
          "/search",
          "/users/*/followers",
          "/users/*/following",
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
