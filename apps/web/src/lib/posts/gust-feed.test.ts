import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import {
  advanceGustPaging,
  gustPagingDelay,
  gustPagingState,
  mergeGustPosts,
  readGustPage,
} from "./gust-feed";
import { externalPostView } from "./presentation";

test("an expired Gust continuation resumes from a fresh head without replaying loaded clips", async () => {
  const cursors: (string | null)[] = [];
  const page = await readGustPage<{
    posts: { id: string }[];
    nextCursor: string;
  }>(
    (cursor) => {
      cursors.push(cursor);
      return cursor
        ? Response.json({ error: "Refresh this feed" }, { status: 410 })
        : Response.json({
            nextCursor: "new-continuation",
            posts: [{ id: "seen" }, { id: "fresh" }],
          });
    },
    "expired-continuation",
    new Set(["seen"])
  );
  expect(cursors).toEqual(["expired-continuation", null]);
  expect(page).toEqual({
    nextCursor: "new-continuation",
    posts: [{ id: "fresh" }],
  });
});

test("Gust outages stay errors instead of looking like a completed feed", async () => {
  await expect(
    readGustPage(() => new Response(null, { status: 503 }), "cursor", new Set())
  ).rejects.toThrow("503");
});

test("a refreshed Gust generation retains clips from previously cached later pages", async () => {
  const next = {
    nextCursor: "new-page-three",
    posts: [{ id: "old-page-two" }, { id: "fresh" }],
  };
  const page = await readGustPage(
    () => Promise.resolve(Response.json(next)),
    "new-page-two",
    new Set(["old-page-two"])
  );
  expect(page).toEqual(next);
});

test.each([0, 1])(
  "a failed Gust source %i remains retryable as its healthy peer finishes",
  (failedIndex) => {
    const sources = [0, 1].map((index) => ({
      enabled: true,
      hasNextPage: true,
      isFetchNextPageError: index === failedIndex,
      isFetchingNextPage: false,
    }));
    expect(gustPagingState(sources)).toEqual({
      canFetchNextPage: true,
      hasNextPage: true,
      isFetchingNextPage: false,
      pageError: true,
    });
    sources[1 - failedIndex].hasNextPage = false;
    expect(gustPagingState(sources)).toEqual({
      canFetchNextPage: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      pageError: true,
    });
    sources[failedIndex].isFetchNextPageError = false;
    expect(gustPagingState(sources).canFetchNextPage).toBe(true);
    sources[failedIndex].enabled = false;
    expect(gustPagingState(sources).hasNextPage).toBe(false);
  }
);

test("empty Gust pages track sparse progress and visible clips or a changed profile reset it", () => {
  let progress = { emptyPages: 0, pages: 0, scope: "software", visible: 0 };
  for (let page = 1; page <= 3; page += 1) {
    progress = advanceGustPaging(progress, "software", page, 0);
  }
  expect(progress.emptyPages).toBe(3);
  expect(advanceGustPaging(progress, "software", 4, 1).emptyPages).toBe(0);
  expect(advanceGustPaging(progress, "art", 1, 0).emptyPages).toBe(0);
  expect(advanceGustPaging(progress, "software", 1, 0).emptyPages).toBe(0);
});

function clip(id: string) {
  const post: ExternalPost = {
    author: {
      displayName: "Example",
      handle: "example.test",
      id: "did:plc:example",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/example.test",
    },
    createdAt: "2026-10-18T00:00:00.000Z",
    id: `at://did:plc:example/app.bsky.feed.post/${id}`,
    labels: [],
    languages: [],
    media: [
      {
        alt: "Clip",
        type: "video",
        url: "https://video.bsky.app/playlist.m3u8",
      },
    ],
    revision: "revision",
    segments: [{ text: id }],
    source: "bluesky",
    text: id,
    upstreamCounts: {},
    url: `https://bsky.app/profile/example.test/post/${id}`,
  };
  return { ...externalPostView(post), isGust: true };
}

test("Gust sources interleave initially and append late arrivals without moving loaded clips", () => {
  const native = [clip("native-one"), clip("native-two")];
  const external = [clip("external-one"), clip("external-two")];
  expect(mergeGustPosts([], native, external)).toEqual([
    native[0],
    external[0],
    native[1],
    external[1],
  ]);
  const first = mergeGustPosts([], native, []);
  const merged = mergeGustPosts(first, native, external);
  expect(merged.slice(0, 2)).toEqual(first);
  expect(merged.slice(2)).toEqual(external);
});

test("Gust merging updates retained cards and removes excluded clips without duplicates", () => {
  const first = clip("one");
  const second = clip("two");
  const updated = { ...first, content: "Updated" };
  expect(mergeGustPosts([first, second], [], [updated, updated])).toEqual([
    updated,
  ]);
  expect(mergeGustPosts([first, second], [], [])).toEqual([]);
});

test("sparse video continuation backs off without stopping pagination", () => {
  expect(gustPagingDelay(0)).toBe(0);
  expect(gustPagingDelay(3)).toBe(400);
  expect(gustPagingDelay(5)).toBe(1600);
  // The ceiling stays low: a long gap on a swipe-driven reel reads as dead.
  expect(gustPagingDelay(1000)).toBe(2000);
});
