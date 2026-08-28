import { describe, expect, test } from "bun:test";

import { extractMetaTags, parseOgMeta } from "./og-parse";

const BASE = "https://example.com/article";

describe("extractMetaTags", () => {
  test("handles property/name, quote styles and attribute order", () => {
    const html = `
      <html><head>
        <meta content="Quoted" property="og:title">
        <meta name='twitter:title' content='Single'>
        <meta name=description content=Bare>
        <meta property="og:ignore" data-skip>
      </head></html>`;
    const tags = extractMetaTags(html);
    const keys = tags.map((tag) => tag.key);
    expect(keys).toContain("og:title");
    expect(keys).toContain("twitter:title");
    expect(keys).toContain("description");
    expect(keys).not.toContain("og:ignore"); // no content attribute
    const og = tags.find((tag) => tag.key === "og:title");
    expect(og?.content).toBe("Quoted");
  });
});

describe("parseOgMeta", () => {
  test("prefers og:* over twitter:* and resolves relative images", () => {
    const html = `
      <head>
        <meta property="og:title" content="The Real Title">
        <meta name="twitter:title" content="Ignored">
        <meta property="og:description" content="First paragraph of the thing">
        <meta property="og:image" content="/img/cover.png?v=2">
        <meta property="og:site_name" content="Example">
      </head>`;
    const meta = parseOgMeta(html, BASE);
    expect(meta.title).toBe("The Real Title");
    expect(meta.description).toBe("First paragraph of the thing");
    expect(meta.siteName).toBe("Example");
    expect(meta.imageUrl).toBe("https://example.com/img/cover.png?v=2");
  });

  test("falls back to twitter:* then <title>", () => {
    const twitterOnly = parseOgMeta(
      `<meta name="twitter:title" content="Tweet"><meta name="twitter:image" content="https://cdn.example.org/x.jpg">`,
      BASE
    );
    expect(twitterOnly.title).toBe("Tweet");
    expect(twitterOnly.imageUrl).toBe("https://cdn.example.org/x.jpg");

    const titleOnly = parseOgMeta(
      "<html><head><title>Just A Title</title></head></html>",
      BASE
    );
    expect(titleOnly.title).toBe("Just A Title");
    expect(titleOnly.imageUrl).toBeNull();
  });

  test("decodes entities and collapses whitespace, capping lengths", () => {
    const long = `Word ${"x".repeat(400)}`;
    const meta = parseOgMeta(
      `<meta property="og:title" content="Tom &amp; Jerry &quot;part 2&quot;">
       <meta property="og:description" content="${long}">`,
      BASE
    );
    expect(meta.title).toBe(`Tom & Jerry "part 2"`);
    expect(meta.description?.length).toBeLessThanOrEqual(300);
    expect(meta.description?.endsWith("…")).toBe(true);
  });

  test("drops non-http(s) image URLs (data:/javascript: never pass)", () => {
    const meta = parseOgMeta(
      `<meta property="og:image" content="data:image/png;base64,AAAA">`,
      BASE
    );
    expect(meta.imageUrl).toBeNull();
  });
});
