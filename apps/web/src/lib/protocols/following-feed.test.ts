// oxlint-disable unicorn/no-await-expression-member -- These assertions inspect feed response fields directly.
import { beforeEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

const cache = new Map<string, string>();
let members = ["did:web:a.test", "did:web:b.test"];
let unavailable = false;
let admitted = true;
let graphVersion = 0;
const requested: URLSearchParams[] = [];
mock.module("./following-store", () => ({
  followingStore: {
    acquire: () => Promise.resolve(admitted),
    get: (key: string) => Promise.resolve(cache.get(key) ?? null),
    release: () => Promise.resolve(),
    set: (key: string, value: string) => {
      cache.set(key, value);
      return Promise.resolve(true);
    },
  },
}));
mock.module("@asm/db", () => ({
  externalFollowAuthors: () =>
    Promise.resolve(
      members.map((did) => ({
        did,
        followedAt: String(graphVersion),
        status: "active",
      }))
    ),
  filterExternalMediaSafety: (posts: ExternalPost[]) => Promise.resolve(posts),
  redis: {
    get: (key: string) => Promise.resolve(cache.get(key) ?? null),
    set: (key: string, value: string) => {
      cache.set(key, value);
      return Promise.resolve("OK");
    },
  },
}));
mock.module("./gateway", () => ({
  ProtocolGatewayError: class extends Error {
    status: number;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
    }
  },
}));
mock.module("./service", () => ({
  readBlueskyProfileResource: (_kind: string, query: URLSearchParams) => {
    requested.push(query);
    return unavailable
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({
          cursor: "tail",
          items: [post(query.get("actor") ?? "", 10)],
        });
  },
}));
const { mergeFollowingPage, readFollowingFeed } =
  await import("./following-feed");
function post(did: string, second: number): ExternalPost {
  return {
    author: {
      displayName: did,
      handle: `${did.slice(8)}`,
      id: did,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: `https://bsky.app/profile/${did}`,
    },
    createdAt: new Date(Date.UTC(2026, 9, 17, 0, 0, second)).toISOString(),
    id: `at://${did}/app.bsky.feed.post/${second}`,
    indexedAt: "2026-10-17T00:00:00.000Z",
    labels: [],
    languages: [],
    media: [],
    revision: "cid",
    segments: [],
    source: "bluesky",
    text: "Live post",
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: `https://bsky.app/profile/${did}/post/${second}`,
  };
}
function state() {
  return {
    membership: "test",
    seen: [] as string[],
    sources: members.map((did) => ({
      cursor: null as string | null,
      did,
      exhausted: false,
      pending: [] as ExternalPost[],
      started: false,
    })),
  };
}
beforeEach(() => {
  cache.clear();
  members = ["did:web:a.test", "did:web:b.test"];
  requested.length = 0;
  unavailable = false;
  admitted = true;
  graphVersion = 0;
});

test("chronological merge replenishes each author before selecting the next head and removes duplicates and foreign reposts", async () => {
  const snapshot = state();
  const read = (did: string, cursor: string | null) =>
    did === members[0]
      ? {
          cursor: cursor ? null : "next",
          items: cursor
            ? [post(did, 8), post(did, 6)]
            : [post(did, 10), post("did:web:foreign.test", 50)],
        }
      : { cursor: null, items: [post(did, 9), post(did, 7)] };
  const first = await mergeFollowingPage(snapshot, read, 3);
  expect(
    first.items.map((item) => new Date(item.createdAt).getUTCSeconds())
  ).toEqual([10, 9, 8]);
  expect(first.hasMore).toBe(true);
  const second = await mergeFollowingPage(snapshot, read, 3);
  expect(
    second.items.map((item) => new Date(item.createdAt).getUTCSeconds())
  ).toEqual([7, 6]);
  expect(second.hasMore).toBe(false);
});

test("partial author outages keep healthy items and retry the failed source on continuation", async () => {
  const snapshot = state();
  const first = await mergeFollowingPage(snapshot, (did) => {
    if (did === members[0]) {
      throw new Error("offline");
    }
    return { cursor: null, items: [post(did, 2)] };
  });
  expect(first.partial).toBe(true);
  expect(first.items).toHaveLength(1);
  const recovered = await mergeFollowingPage(snapshot, (did) => ({
    cursor: null,
    items: [post(did, 1)],
  }));
  expect(recovered.items).toHaveLength(1);
  expect(recovered.hasMore).toBe(false);
  await expect(
    mergeFollowingPage(state(), () => Promise.reject(new Error("offline")))
  ).rejects.toThrow("following_unavailable");
});

test("private cursors cannot cross accounts, changed follows, or content-policy revisions", async () => {
  const first = await readFollowingFeed(
    "viewer-a",
    undefined,
    AbortSignal.timeout(1000),
    "test",
    "v1"
  );
  expect(first.cursor).not.toBeNull();
  expect(requested.every((query) => query.get("pins") === "0")).toBe(true);
  await expect(
    readFollowingFeed(
      "viewer-b",
      first.cursor ?? undefined,
      AbortSignal.timeout(1000),
      "test",
      "v1"
    )
  ).rejects.toThrow("expired_cursor");
  await expect(
    readFollowingFeed(
      "viewer-a",
      first.cursor ?? undefined,
      AbortSignal.timeout(1000),
      "test",
      "v2"
    )
  ).rejects.toThrow("expired_cursor");
  members = ["did:web:b.test"];
  await expect(
    readFollowingFeed(
      "viewer-a",
      first.cursor ?? undefined,
      AbortSignal.timeout(1000),
      "test",
      "v1"
    )
  ).rejects.toThrow("expired_cursor");
});

test("no follows perform no upstream reads; a head cache cannot cross users or membership", async () => {
  members = [];
  expect(
    (
      await readFollowingFeed(
        "empty",
        undefined,
        AbortSignal.timeout(1000),
        "test"
      )
    ).items
  ).toEqual([]);
  expect(requested).toHaveLength(0);
  members = ["did:web:a.test"];
  const first = await readFollowingFeed(
    "viewer",
    undefined,
    AbortSignal.timeout(1000),
    "test"
  );
  const reads = requested.length;
  expect(
    (
      await readFollowingFeed(
        "viewer",
        undefined,
        AbortSignal.timeout(1000),
        "test"
      )
    ).items
  ).toEqual(first.items);
  expect(requested).toHaveLength(reads);
  members = [];
  expect(
    (
      await readFollowingFeed(
        "viewer",
        undefined,
        AbortSignal.timeout(1000),
        "test"
      )
    ).items
  ).toEqual([]);
});

test("event probes bypass cached heads and concurrent builds are rejected before upstream fan-out", async () => {
  const first = await readFollowingFeed(
    "viewer",
    undefined,
    AbortSignal.timeout(1000),
    "test"
  );
  unavailable = true;
  await expect(
    readFollowingFeed(
      "viewer",
      undefined,
      AbortSignal.timeout(1000),
      "test",
      "default",
      true
    )
  ).rejects.toThrow("following_unavailable");
  unavailable = false;
  admitted = false;
  requested.length = 0;
  await expect(
    readFollowingFeed(
      "viewer",
      undefined,
      AbortSignal.timeout(1000),
      "test",
      "default",
      true
    )
  ).rejects.toThrow("following_busy");
  expect(requested).toHaveLength(0);
  admitted = true;
  graphVersion += 1;
  await expect(
    readFollowingFeed(
      "viewer",
      first.cursor ?? undefined,
      AbortSignal.timeout(1000),
      "test"
    )
  ).rejects.toThrow("expired_cursor");
});

test("foreign repost-only windows are advanced before choosing the chronological head", async () => {
  const snapshot = state();
  const result = await mergeFollowingPage(snapshot, (did, cursor) => {
    if (did !== members[0]) {
      return Promise.resolve({ cursor: null, items: [post(did, 9)] });
    }
    if (cursor) {
      return Promise.resolve({ cursor: null, items: [post(did, 12)] });
    }
    return Promise.resolve({
      cursor: "own-posts",
      items: [post("did:web:foreign.test", 20)],
    });
  });
  expect(
    result.items.map((item) => new Date(item.createdAt).getUTCSeconds())
  ).toEqual([12, 9]);
  expect(result.partial).toBe(false);
});

test("Home's optional cached read never fans out to authors on a cold miss", async () => {
  cache.clear();
  requested.length = 0;
  const page = await readFollowingFeed(
    "reader",
    undefined,
    new AbortController().signal,
    "req",
    "cached-only-test",
    false,
    false,
    true
  );
  expect(page.items).toEqual([]);
  expect(page.partial).toBe(true);
  expect(requested).toHaveLength(0);
});
