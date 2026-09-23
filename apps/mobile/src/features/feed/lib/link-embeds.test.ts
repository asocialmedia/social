import { describe, expect, test } from "bun:test";

import {
  MAX_POST_EMBEDS,
  embedImageUrl,
  isSafeYoutubeId,
  parseStoredEmbeds,
  youtubeEmbedThumbnail,
} from "./link-embeds";

describe("parseStoredEmbeds", () => {
  test("parses a stored JSON string of link embeds", () => {
    const stored = JSON.stringify([
      {
        description: "A page",
        imageUrl: "https://example.com/og.png",
        siteName: "Example",
        title: "Example page",
        type: "link",
        url: "https://example.com/page",
      },
    ]);
    expect(parseStoredEmbeds(stored)).toEqual([
      {
        description: "A page",
        imageUrl: "https://example.com/og.png",
        siteName: "Example",
        title: "Example page",
        type: "link",
        url: "https://example.com/page",
        videoAuthor: null,
        videoId: null,
      },
    ]);
  });

  test("drops entries without url/title and youtube entries with bad ids", () => {
    expect(
      parseStoredEmbeds([
        { title: "No url" },
        { url: "https://example.com/x" },
        {
          title: "Bad video",
          type: "youtube",
          url: "https://youtube.com/watch?v=xxx",
          videoId: "not-an-id",
        },
        {
          title: "Good video",
          type: "youtube",
          url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          videoAuthor: "Somebody",
          videoId: "dQw4w9WgXcQ",
        },
      ])
    ).toEqual([
      {
        description: null,
        imageUrl: null,
        siteName: null,
        title: "Good video",
        type: "youtube",
        url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        videoAuthor: "Somebody",
        videoId: "dQw4w9WgXcQ",
      },
    ]);
  });

  test("rejects malformed input and caps at five embeds", () => {
    expect(parseStoredEmbeds("{oops")).toEqual([]);
    expect(parseStoredEmbeds(null)).toEqual([]);
    const many = [];
    for (let index = 0; index < MAX_POST_EMBEDS + 3; index += 1) {
      many.push({ title: `T${index}`, url: `https://example.com/${index}` });
    }
    expect(parseStoredEmbeds(many)).toHaveLength(MAX_POST_EMBEDS);
  });
});

describe("youtube helpers", () => {
  test("accepts strict 11-char ids and builds the poster URL", () => {
    expect(isSafeYoutubeId("dQw4w9WgXcQ")).toBe(true);
    expect(isSafeYoutubeId("short")).toBe(false);
    expect(isSafeYoutubeId(null)).toBe(false);
    expect(youtubeEmbedThumbnail("dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    );
    expect(youtubeEmbedThumbnail("nope")).toBeNull();
  });

  test("roots the image proxy at the api base", () => {
    expect(embedImageUrl("http://localhost:3000/", "https://x.com/a.png")).toBe(
      "http://localhost:3000/api/link-preview/image?url=https%3A%2F%2Fx.com%2Fa.png"
    );
  });
});
