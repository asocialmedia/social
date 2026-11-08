import { describe, expect, test } from "bun:test";

import {
  buildSitemapIndexXml,
  buildSitemapXml,
  isSitemapId,
  SITEMAP_IDS,
} from "./sitemap";

describe("isSitemapId", () => {
  test("accepts known ids", () => {
    for (const id of SITEMAP_IDS) {
      expect(isSitemapId(id)).toBe(true);
    }
  });

  test("rejects unknown ids and paths", () => {
    expect(isSitemapId("posts.xml")).toBe(false);
    expect(isSitemapId("core.xml")).toBe(false);
    expect(isSitemapId("")).toBe(false);
    expect(isSitemapId("unknown")).toBe(false);
    expect(isSitemapId("POSTS")).toBe(false);
  });
});

describe("buildSitemapXml", () => {
  test("video sitemap identifies watch pages and escapes user content", () => {
    const xml = buildSitemapXml([
      {
        url: "https://asocialmedia.cc/watch/post/media",
        videos: [
          {
            contentUrl: "https://asocialmedia.cc/api/media/media",
            description: "A <special> moment",
            publicationDate: new Date("2026-11-07T10:00:00.000Z"),
            thumbnailUrl: "https://asocialmedia.cc/api/media/media?thumb=1",
            title: "Friends & family",
          },
        ],
      },
    ]);
    expect(xml).toContain(
      'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"'
    );
    expect(xml).toContain("<video:title>Friends &amp; family</video:title>");
    expect(xml).toContain("A &lt;special&gt; moment");
    expect(xml).toContain(
      "<video:content_loc>https://asocialmedia.cc/api/media/media</video:content_loc>"
    );
  });
  test("emits urlset with loc and lastmod", () => {
    const xml = buildSitemapXml([
      {
        lastModified: new Date("2026-08-20T12:00:00.000Z"),
        url: "https://asocialmedia.cc/posts/abc",
      },
      { url: "https://asocialmedia.cc" },
    ]);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>https://asocialmedia.cc/posts/abc</loc>");
    expect(xml).toContain("<lastmod>2026-08-20T12:00:00+00:00</lastmod>");
    expect(xml).toContain("<loc>https://asocialmedia.cc</loc>");
  });

  test("escapes xml special chars in urls", () => {
    const xml = buildSitemapXml([
      { url: "https://asocialmedia.cc/hashtag/a&b" },
    ]);

    expect(xml).toContain("a&amp;b");
    expect(xml).not.toContain("a&b</loc>");
  });

  test("handles empty url list", () => {
    const xml = buildSitemapXml([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });

  test("escapes hashtag urls with encoded chars", () => {
    const xml = buildSitemapXml([
      { url: "https://asocialmedia.cc/hashtag/%23test" },
    ]);

    expect(xml).toContain("https://asocialmedia.cc/hashtag/%23test");
  });
});

describe("buildSitemapIndexXml", () => {
  test("emits sitemapindex with absolute locs", () => {
    const xml = buildSitemapIndexXml([
      {
        lastModified: new Date("2026-08-20T00:00:00.000Z"),
        url: "https://asocialmedia.cc/sitemaps/posts.xml",
      },
      { url: "https://asocialmedia.cc/sitemaps/core.xml" },
    ]);

    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(
      "<loc>https://asocialmedia.cc/sitemaps/posts.xml</loc>"
    );
    expect(xml).toContain("<lastmod>2026-08-20T00:00:00+00:00</lastmod>");
    expect(xml).toContain(
      "<loc>https://asocialmedia.cc/sitemaps/core.xml</loc>"
    );
  });

  test("emits all sitemap ids", () => {
    const xml = buildSitemapIndexXml(
      SITEMAP_IDS.map((id) => ({
        url: `https://asocialmedia.cc/sitemaps/${id}.xml`,
      }))
    );

    for (const id of SITEMAP_IDS) {
      expect(xml).toContain(`/sitemaps/${id}.xml`);
    }
  });
});
