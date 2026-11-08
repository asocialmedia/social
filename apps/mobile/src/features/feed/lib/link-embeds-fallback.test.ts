import { describe, expect, test } from "bun:test";

import {
  blueskyLinkFallbacks,
  linkFallbackLabel,
  parseStoredEmbeds,
} from "./link-embeds";

describe("linkFallbackLabel", () => {
  test("prefers a human label over the URL", () => {
    expect(linkFallbackLabel("https://example.com/a", "A great read")).toBe(
      "A great read"
    );
  });

  test("falls back to host plus path for URL-like facet text", () => {
    expect(
      linkFallbackLabel("https://example.com/a?b=c", "https://example.com/a")
    ).toBe("example.com/a?b=c");
  });

  test("returns the raw input when the URL does not parse", () => {
    expect(linkFallbackLabel("not a url", "not a url")).toBe("not a url");
  });
});

describe("blueskyLinkFallbacks", () => {
  test("returns no fallback when a stored embed already exists", () => {
    const stored = parseStoredEmbeds([
      { title: "Stored", type: "link", url: "https://example.com/stored" },
    ]);
    expect(
      blueskyLinkFallbacks(
        [{ href: "https://example.com/other", text: "other" }],
        null,
        stored
      )
    ).toEqual([]);
  });

  test("picks the first faceted link and skips mentions", () => {
    const fallbacks = blueskyLinkFallbacks(
      [
        { href: null, text: "@alice" },
        { href: "https://example.com/first", text: "First" },
        { href: "https://example.com/second", text: "Second" },
      ],
      null,
      []
    );
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.url).toBe("https://example.com/first");
    expect(fallbacks[0]?.title).toBe("First");
    expect(fallbacks[0]?.siteName).toBe("example.com");
  });

  test("detects an unfaceted URL in plain segments", () => {
    const fallbacks = blueskyLinkFallbacks(
      [{ text: "read this https://example.com/plain." }],
      null,
      []
    );
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.url).toBe("https://example.com/plain");
  });

  test("falls back to the post text when there are no segments", () => {
    const fallbacks = blueskyLinkFallbacks(
      [],
      "see https://example.com/text",
      []
    );
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.url).toBe("https://example.com/text");
  });

  test("returns nothing when the body has no links", () => {
    expect(blueskyLinkFallbacks([{ text: "hello" }], null, [])).toEqual([]);
  });

  test("drops unparseable URLs", () => {
    expect(
      blueskyLinkFallbacks([{ href: "not a url", text: "x" }], null, [])
    ).toEqual([]);
  });
});
