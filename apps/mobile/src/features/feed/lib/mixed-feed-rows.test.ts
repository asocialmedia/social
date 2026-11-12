import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import type { FeedRow } from "./feed-rows";
import {
  mixedFeedRows,
  areTimelineRowsIdentical,
  nativePostForRow,
  stableTimelineRows,
} from "./mixed-feed-rows";

const external: ExternalPost = {
  author: {
    displayName: "External",
    handle: "example.test",
    id: "did:web:example.test",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/example.test",
  },
  createdAt: "2026-10-15T00:00:00Z",
  id: "at://did:web:example.test/app.bsky.feed.post/one",
  indexedAt: "2026-10-15T00:00:00Z",
  labels: [],
  languages: [],
  media: [],
  revision: "cid",
  segments: [],
  source: "bluesky",
  text: "Example",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/example.test/post/one",
};

test("outside posts never split native reply rails", () => {
  const rows: FeedRow[] = [
    {
      hasThreadChild: true,
      hasThreadParent: false,
      post: {
        createdAt: "2026-10-14T00:00:00Z",
        id: "parent",
        userId: "author",
      },
    },
    {
      hasThreadChild: false,
      hasThreadParent: true,
      post: {
        createdAt: "2026-10-16T00:00:00Z",
        id: "reply",
        userId: "author",
      },
    },
  ];
  const mixed = mixedFeedRows(rows, [external], "all", true);
  expect(mixed.map((row) => row.id)).toEqual([
    "asm:parent",
    "asm:reply",
    `bluesky:${external.id}`,
  ]);
  expect(nativePostForRow(mixed[0])?.id).toBe("parent");
  expect(nativePostForRow(mixed[2])).toBeUndefined();
});

test("stableTimelineRows reuses row objects when posts are untouched", () => {
  const rows: FeedRow[] = [
    {
      hasThreadChild: false,
      hasThreadParent: false,
      post: {
        createdAt: "2026-10-14T00:00:00Z",
        id: "parent",
        userId: "author",
      },
    },
  ];
  const first = mixedFeedRows(rows, [external], "all", true);
  // A reconcile rebuilds every wrapper around the same post references.
  const rebuilt = mixedFeedRows(rows, [external], "all", true);
  const stable = stableTimelineRows(first, rebuilt);
  expect(stable.map((row) => row.id)).toEqual(first.map((row) => row.id));
  for (const [index, row] of stable.entries()) {
    expect(row).toBe(first[index]);
  }
});

test("stableTimelineRows replaces rows whose post moved", () => {
  const post = {
    createdAt: "2026-10-14T00:00:00Z",
    id: "parent",
    userId: "author",
  };
  const rows: FeedRow[] = [
    { hasThreadChild: false, hasThreadParent: false, post },
  ];
  const first = mixedFeedRows(rows, [external], "all", true);
  const changed: FeedRow = {
    hasThreadChild: false,
    hasThreadParent: false,
    post: { ...post, viewCount: 42 },
  };
  const rebuilt = mixedFeedRows([changed], [external], "all", true);
  const stable = stableTimelineRows(first, rebuilt);
  const stableAsm = stable.find((row) => row.id === "asm:parent");
  const firstAsm = first.find((row) => row.id === "asm:parent");
  expect(stableAsm).not.toBe(firstAsm);
  expect(stableAsm?.id).toBe(firstAsm?.id);
  for (const row of stable) {
    if (row.id === "asm:parent") {
      continue;
    }
    const prior = first.find((candidate) => candidate.id === row.id);
    expect(prior).toBeDefined();
    expect(row).toBe(prior as (typeof stable)[number]);
  }
});

test("areTimelineRowsIdentical compares order and identity", () => {
  const rows: FeedRow[] = [
    {
      hasThreadChild: false,
      hasThreadParent: false,
      post: {
        createdAt: "2026-10-14T00:00:00Z",
        id: "parent",
        userId: "author",
      },
    },
  ];
  const first = mixedFeedRows(rows, [external], "all", true);
  expect(areTimelineRowsIdentical(first, first)).toBe(true);
  expect(areTimelineRowsIdentical(first, [])).toBe(false);
  const rebuilt = mixedFeedRows(rows, [external], "all", true);
  expect(areTimelineRowsIdentical(first, rebuilt)).toBe(false);
  expect(
    areTimelineRowsIdentical(first, stableTimelineRows(first, rebuilt))
  ).toBe(true);
});

test("ranked first batches interleave networks while latest merges by date", () => {
  const native: FeedRow[] = ["16", "14"].map((day) => ({
    hasThreadChild: false,
    hasThreadParent: false,
    post: {
      createdAt: `2026-10-${day}T00:00:00Z`,
      id: day,
      userId: "author",
    },
  }));
  const remote = [
    external,
    { ...external, createdAt: "2026-10-13T00:00:00Z", id: "second" },
  ];
  expect(
    mixedFeedRows(native, remote, "all", false).map((row) => row.kind)
  ).toEqual(["asm", "bluesky", "bluesky", "asm"]);
  expect(
    mixedFeedRows(native, remote, "all", true).map((row) => row.id)
  ).toEqual(["asm:16", `bluesky:${external.id}`, "asm:14", "bluesky:second"]);
});
