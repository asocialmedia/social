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
        // Account-scoped, private, auth flows, and internal search are disallowed
        // to keep crawler budget focused on indexable public content.
        disallow: [
          "/api/",
          "/messages",
          "/search",
          "/login",
          "/signup",
          "/reset-password",
          "/two-factor",
          "/verify-email",
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
