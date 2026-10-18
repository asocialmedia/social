import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { mergeGustPosts } from "./gust-feed";
import { externalPostView } from "./presentation";

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
