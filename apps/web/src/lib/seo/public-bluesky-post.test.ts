import { afterAll, beforeEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

const read = mock((): Promise<ExternalPost[]> => Promise.resolve([]));
const cacheLife = mock(() => {});
const io = mock(() => Promise.resolve());
const frameworkError = new Error("prerender interrupted");
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ cacheLife, io }));
mock.module("next/navigation", () => ({
  unstable_rethrow(error: unknown) {
    if (error === frameworkError) {
      throw error;
    }
  },
}));
mock.module("@/lib/protocols/service", () => ({ readBlueskyPosts: read }));
const { getPublicBlueskyPost } = await import("./public-bluesky-post");
const originalWarn = console.warn;
const warn = mock(() => {
  expect(io).toHaveBeenCalledTimes(1);
});
console.warn = warn;
afterAll(() => {
  console.warn = originalWarn;
});
beforeEach(() => {
  read.mockReset();
  io.mockClear();
  cacheLife.mockClear();
  warn.mockClear();
});
const uri = "at://did:plc:example/app.bsky.feed.post/123";

test("source outages defer logging beyond prerender and keep the preview fallback", async () => {
  read.mockRejectedValue(new Error("media_assessment_pending"));
  expect(await getPublicBlueskyPost(uri)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(
    "Public Bluesky preview unavailable",
    "media_assessment_pending"
  );
  expect(cacheLife).toHaveBeenCalledTimes(1);
  expect(cacheLife).toHaveBeenCalledWith({
    expire: 2,
    revalidate: 0,
    stale: 0,
  });
});
test("framework interruptions propagate without logging or replacing the route tree", async () => {
  read.mockRejectedValue(frameworkError);
  await expect(getPublicBlueskyPost(uri)).rejects.toBe(frameworkError);
  expect(io).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});
test("invalid addresses never request a source preview", async () => {
  expect(await getPublicBlueskyPost("https://invalid.test")).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

test("successful missing posts retain the normal preview lifetime and guest policy", async () => {
  read.mockResolvedValue([]);
  expect(await getPublicBlueskyPost(uri)).toBeNull();
  expect(read).toHaveBeenCalledWith(
    [uri],
    undefined,
    "public-post-seo",
    false,
    true,
    false
  );
  expect(cacheLife).toHaveBeenCalledTimes(1);
  expect(cacheLife).toHaveBeenCalledWith({
    expire: 300,
    revalidate: 60,
    stale: 60,
  });
  expect(warn).not.toHaveBeenCalled();
});

test("an upstream outage can recover to a sanitized public preview on the next read", async () => {
  const post: ExternalPost = {
    author: {
      displayName: "Example author",
      handle: "example.bsky.social",
      id: "did:plc:example",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/did:plc:example",
    },
    createdAt: "2026-11-07T10:00:00.000Z",
    id: uri,
    indexedAt: "2026-11-07T10:00:00.000Z",
    labels: [],
    languages: ["en"],
    media: [],
    networkRecommendationToken: "viewer-only-token",
    revision: "cid",
    segments: [{ text: "A public post." }],
    source: "bluesky",
    text: "A public post.",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:example/post/123",
  };
  read.mockRejectedValueOnce(new Error("upstream_unavailable"));
  read.mockResolvedValueOnce([post]);
  expect(await getPublicBlueskyPost(uri)).toBeNull();
  const recovered = await getPublicBlueskyPost(uri);
  expect(recovered?.id).toBe(uri);
  expect(recovered?.networkRecommendationToken).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2);
  expect(cacheLife).toHaveBeenNthCalledWith(1, {
    expire: 2,
    revalidate: 0,
    stale: 0,
  });
  expect(cacheLife).toHaveBeenNthCalledWith(2, {
    expire: 300,
    revalidate: 60,
    stale: 60,
  });
});
