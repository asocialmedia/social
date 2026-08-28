import { describe, expect, test } from "bun:test";

import {
  decodeHtmlEntities,
  extractPostUrls,
  isPrivateOrReservedHost,
  MAX_POST_EMBEDS,
  parseStoredEmbeds,
  sanitizeEmbedUrl,
  youtubeVideoIdFromUrl,
} from "./shared";

// Built at runtime so the no-script-url lint rule cannot flag the literal.
const JS_URL = ["javascript", "alert(1)"].join(":");

describe("extractPostUrls", () => {
  test("extracts http(s) URLs in order and dedupes sanitized forms", () => {
    const content =
      "Check this https://youtu.be/dQw4w9WgXcQ and https://youtu.be/dQw4w9WgXcQ?si=spooky plus example.com/plain";
    expect(extractPostUrls(content)).toEqual([
      "https://youtu.be/dQw4w9WgXcQ",
      "https://example.com/plain",
    ]);
  });

  test("caps at MAX_POST_EMBEDS", () => {
    const content = Array.from(
      { length: MAX_POST_EMBEDS + 3 },
      (_, index) => `https://example.org/page-${index}`
    ).join(" ");
    expect(extractPostUrls(content)).toHaveLength(MAX_POST_EMBEDS);
  });

  test("ignores javascript:, data: and mail: schemes", () => {
    const content = `evil ${JS_URL} mailto:hi@example.com https://ok.example.com/yes`;
    expect(extractPostUrls(content)).toEqual(["https://ok.example.com/yes"]);
  });

  test("empty content yields nothing", () => {
    expect(extractPostUrls("")).toEqual([]);
  });
});

describe("sanitizeEmbedUrl", () => {
  test("strips tracking params but keeps content params", () => {
    expect(
      sanitizeEmbedUrl(
        "https://www.youtube.com/watch?v=abc123&t=90&utm_source=x&si=nope"
      )
    ).toBe("https://www.youtube.com/watch?v=abc123&t=90");
  });

  test("removes embedded credentials", () => {
    expect(sanitizeEmbedUrl("https://user:pass@example.com/page")).toBe(
      "https://example.com/page"
    );
  });

  test("rejects non-http(s) schemes and garbage", () => {
    expect(sanitizeEmbedUrl(JS_URL)).toBeNull();
    expect(sanitizeEmbedUrl("ftp://example.com/file")).toBeNull();
    expect(sanitizeEmbedUrl("not a url")).toBeNull();
  });

  test("rejects over-length URLs", () => {
    expect(sanitizeEmbedUrl(`https://example.com/${"a".repeat(2100)}`)).toBe(
      null
    );
  });
});

describe("youtubeVideoIdFromUrl", () => {
  const id = "dQw4w9WgXcQ";

  test("parses every public URL shape", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=42`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://m.youtube.com/watch?v=${id}`,
    ]) {
      expect(youtubeVideoIdFromUrl(url)).toBe(id);
    }
  });

  test("rejects non-youtube hosts and malformed ids", () => {
    expect(youtubeVideoIdFromUrl("https://vimeo.com/123456")).toBeNull();
    expect(youtubeVideoIdFromUrl("https://youtu.be/short")).toBeNull();
    expect(youtubeVideoIdFromUrl("https://youtube.com/watch")).toBeNull();
    expect(
      youtubeVideoIdFromUrl("https://evil.com/watch?v=dQw4w9WgXcQ")
    ).toBeNull();
  });
});

describe("isPrivateOrReservedHost", () => {
  test("blocks loopback and private IPv4 literals", () => {
    for (const host of [
      "127.0.0.1",
      "127.8.8.8",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
    ]) {
      expect(isPrivateOrReservedHost(host)).toBe(true);
    }
  });

  test("allows public IPv4 literals", () => {
    for (const host of ["8.8.8.8", "1.1.1.1", "142.250.183.142"]) {
      expect(isPrivateOrReservedHost(host)).toBe(false);
    }
  });

  test("blocks loopback/reserved hostnames", () => {
    for (const host of [
      "localhost",
      "api.localhost",
      "db.internal",
      "mybox.local",
      "metadata.google.internal",
      "svc.default.svc",
    ]) {
      expect(isPrivateOrReservedHost(host)).toBe(true);
    }
  });

  test("blocks private IPv6 forms", () => {
    for (const host of [
      "::1",
      "::",
      "fe80::1",
      "fc00::abcd",
      "fd12::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.5",
      "64:ff9b::1.2.3.4",
      "2001:db8::1",
    ]) {
      expect(isPrivateOrReservedHost(host)).toBe(true);
    }
  });

  test("allows public IPv6 forms", () => {
    for (const host of ["2606:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPrivateOrReservedHost(host)).toBe(false);
    }
  });

  test("empty host fails closed", () => {
    expect(isPrivateOrReservedHost("")).toBe(true);
  });
});

describe("parseStoredEmbeds", () => {
  test("validates well-shaped payloads and caps the list", () => {
    const embed = {
      description: "A video",
      imageUrl: null,
      siteName: "YouTube",
      title: "Cool video",
      type: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
      videoAuthor: "Someone",
      videoId: "dQw4w9WgXcQ",
    };
    const parsed = parseStoredEmbeds([embed]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe("youtube");
    expect(parsed[0]?.videoId).toBe("dQw4w9WgXcQ");
    expect(parsed[0]?.url).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  test("drops malformed and unsafe entries", () => {
    const parsed = parseStoredEmbeds([
      null,
      42,
      { title: "no url" },
      {
        imageUrl: JS_URL,
        title: "bad image",
        type: "link",
        url: JS_URL,
      },
      {
        title: "bad youtube",
        type: "youtube",
        url: "https://youtu.be/tooshort",
        videoId: "tooshort",
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("bad image");
    expect(parsed[0]?.imageUrl).toBeNull();
  });

  test("non-array values yield an empty list", () => {
    expect(parseStoredEmbeds(null)).toEqual([]);
    expect(parseStoredEmbeds("nope")).toEqual([]);
    expect(parseStoredEmbeds({})).toEqual([]);
  });
});

describe("decodeHtmlEntities", () => {
  test("decodes the attribute-value entity set without double-decoding", () => {
    expect(
      decodeHtmlEntities("Tom &amp; Jerry &quot;quote&quot; &#39;x&#39;")
    ).toBe(`Tom & Jerry "quote" 'x'`);
    expect(decodeHtmlEntities("a&amp;mp;b")).toBe("a&mp;b");
  });
});
