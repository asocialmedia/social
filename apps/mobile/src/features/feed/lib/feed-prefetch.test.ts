import { describe, expect, test } from "bun:test";

import { feedPrefetchUrls } from "./feed-prefetch";
import type { FeedMedia, FeedPost } from "./feed-types";

function post(id: string, attachments: FeedMedia[]): FeedPost {
  return {
    _count: { comments: 0, mentions: 0, vote: 0 },
    attachments,
    bookmarks: [],
    createdAt: "2026-10-06T00:00:00Z",
    id,
    mentions: [],
    tags: [],
    userId: "viewer",
    vote: [],
  };
}

const API = "https://api.test";

describe("feed image prefetch", () => {
  test("metadata-only view reconciliations do not restart prefetch work", () => {
    const original = [post("p", [{ id: "image", type: "IMAGE" }])];
    const reconciled = original.map((item) => ({ ...item, viewCount: 200 }));
    expect(JSON.stringify(feedPrefetchUrls(original, API))).toBe(
      JSON.stringify(feedPrefetchUrls(reconciled, API))
    );
  });

  test("matches full quality singles, grid variants, video posters and animated originals", () => {
    expect(
      feedPrefetchUrls(
        [
          post("single", [{ id: "image", type: "IMAGE" }]),
          post("grid", [
            { id: "grid-a", type: "IMAGE" },
            { id: "grid-b", type: "IMAGE" },
          ]),
          post("video", [{ id: "clip", type: "VIDEO" }]),
          post("gif", [
            { id: "animated", mimeType: "image/gif", type: "IMAGE" },
          ]),
          post("audio", [{ id: "sound", type: "AUDIO" }]),
        ],
        API
      )
    ).toEqual([
      `${API}/api/media/image/v/lg-webp.webp`,
      `${API}/api/media/grid-a/v/md-webp.webp`,
      `${API}/api/media/grid-b/v/md-webp.webp`,
      `${API}/api/media/clip?thumb=1`,
      `${API}/api/media/animated`,
    ]);
  });

  test("deduplicates URLs while keeping a bounded parallel prefetch batch", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      post(`p${i}`, [{ id: `m${i}`, type: "IMAGE" }])
    );
    expect(feedPrefetchUrls(items, API)).toHaveLength(16);
    const duplicate = post("duplicate", [{ id: "shared", type: "IMAGE" }]);
    expect(feedPrefetchUrls([duplicate, duplicate], API)).toHaveLength(1);
  });
});
