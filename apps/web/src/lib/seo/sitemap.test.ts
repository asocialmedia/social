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

  test("emits all four ids", () => {
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
