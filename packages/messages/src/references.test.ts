import { describe, expect, test } from "bun:test";

import { extractMessageReferences } from "./references";

describe("extractMessageReferences", () => {
  test("keeps media and post references as identifiers instead of indexing URLs", () => {
    expect(
      extractMessageReferences({
        images: [
          { url: "/api/media/media_1", width: 200 },
          { url: "/api/media/media_2", width: 300 },
        ],
        kind: "image",
        type: "media",
      })
    ).toEqual([
      {
        kind: "media",
        mediaKind: "image",
        ordinal: 0,
        requiredId: "media_1",
        url: "/api/media/media_1",
      },
      {
        kind: "media",
        mediaKind: "image",
        ordinal: 1,
        requiredId: "media_2",
        url: "/api/media/media_2",
      },
    ]);
    expect(
      extractMessageReferences({ postId: "post-7", type: "post" })
    ).toEqual([{ kind: "post", ordinal: 0, requiredId: "post-7" }]);
  });

  test("sanitizes, deduplicates and bounds message links", () => {
    expect(
      extractMessageReferences({
        content:
          "See www.example.com/a?utm_source=x, https://www.example.com/a and https://example.com/b.",
        type: "text",
      })
    ).toEqual([
      { kind: "link", ordinal: 0, url: "https://www.example.com/a" },
      { kind: "link", ordinal: 1, url: "https://example.com/b" },
    ]);
  });

  test("does not create link references for non-web schemes or malformed URLs", () => {
    expect(
      extractMessageReferences({
        content: `${"java"}script:alert(1) mailto:person@example.com`,
        type: "text",
      })
    ).toEqual([]);
  });

  test("caps the references produced by adversarially large link bodies", () => {
    const content = Array.from(
      { length: 50 },
      (_, index) => `https://example.com/${index}`
    ).join(" ");
    expect(extractMessageReferences({ content, type: "text" })).toHaveLength(5);
  });
});
