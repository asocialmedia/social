import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const read = mock((): Promise<[]> => Promise.resolve([]));
const io = mock(() => Promise.resolve());
const frameworkError = new Error("prerender interrupted");
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ cacheLife() {}, io }));
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
  warn.mockClear();
});
const uri = "at://did:plc:example/app.bsky.feed.post/123";

test("source outages defer logging beyond prerender and keep the preview fallback", async () => {
  read.mockRejectedValue(new Error("media_assessment_pending"));
  expect(await getPublicBlueskyPost(uri)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
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
