import { describe, expect, test } from "bun:test";

import type { FeedPost } from "@/features/feed/lib/feed-types";

import {
  advanceProfileActivity,
  mergeProfileActivity,
  nativeActivityAt,
  profileActivityOrder,
} from "./profile-activity-order";
import type { ExternalProfileActivityItem } from "./profile-activity-schema";
import type { ProfileFeedItem } from "./profile-feed-rows";
import type { ProfileReply } from "./profile-view-model";

function post(id: string, createdAt: string, amplifiedAt?: string): FeedPost {
  const value: FeedPost = { content: id, createdAt, id, userId: "user-1" };
  return amplifiedAt ? Object.assign(value, { amplifiedAt }) : value;
}

function reply(id: string, createdAt: string): ProfileReply {
  return {
    attachments: [],
    content: id,
    createdAt,
    id,
    parent: null,
    post: post(`post-${id}`, createdAt),
    votes: [],
  };
}

function external(id: string, createdAt: string): ExternalProfileActivityItem {
  return { createdAt, id, post: null, uri: `at://did:plc:x/post/${id}` };
}

function ids(items: ProfileFeedItem[]) {
  return items.map((item) => `${item.kind}:${item.value.id}`);
}

describe("profileActivityOrder", () => {
  test("sorts newest first, breaks ties by id, and drops duplicates", () => {
    const rows = [
      { at: "2026-01-01T00:00:00.000Z", id: "b", type: "native" },
      { at: "2026-01-03T00:00:00.000Z", id: "c", type: "external" },
      { at: "2026-01-01T00:00:00.000Z", id: "a", type: "native" },
      { at: "2026-01-01T00:00:00.000Z", id: "a", type: "native" },
      { at: "2026-01-01T00:00:00.000Z", id: "a", type: "external" },
    ];
    expect(
      profileActivityOrder(rows).map((row) => `${row.type}:${row.id}`)
    ).toEqual(["external:c", "native:a", "external:a", "native:b"]);
  });

  test("hides every row while a source is still pending", () => {
    const rows = [{ at: "2026-01-01T00:00:00.000Z", id: "a", type: "native" }];
    expect(
      profileActivityOrder(rows, [
        { hasNextPage: false },
        { hasNextPage: undefined, pending: true },
      ])
    ).toEqual([]);
  });

  test("holds rows at or below the newest unread boundary", () => {
    const rows = [
      { at: "2026-01-05T00:00:00.000Z", id: "new", type: "native" },
      { at: "2026-01-03T00:00:00.000Z", id: "edge", type: "external" },
      { at: "2026-01-02T00:00:00.000Z", id: "old", type: "native" },
    ];
    const sources = [
      { boundary: "2026-01-02T00:00:00.000Z", hasNextPage: true },
      { boundary: "2026-01-03T00:00:00.000Z", hasNextPage: true },
    ];
    expect(profileActivityOrder(rows, sources).map((row) => row.id)).toEqual([
      "new",
    ]);
    expect(advanceProfileActivity(sources)).toEqual([false, true]);
  });

  test("a source with no boundary but more pages blocks everything", () => {
    const sources = [
      { boundary: null, hasNextPage: true },
      { boundary: "2026-01-03T00:00:00.000Z", hasNextPage: true },
    ];
    expect(
      profileActivityOrder(
        [{ at: "2026-01-09T00:00:00.000Z", id: "a", type: "native" }],
        sources
      )
    ).toEqual([]);
    expect(advanceProfileActivity(sources)).toEqual([true, false]);
  });

  test("never advances while pending, nor a finished source", () => {
    expect(
      advanceProfileActivity([
        { hasNextPage: true, pending: true },
        { hasNextPage: true },
      ])
    ).toEqual([false, false]);
    expect(
      advanceProfileActivity([{ hasNextPage: false }, { hasNextPage: true }])
    ).toEqual([false, true]);
  });
});

describe("nativeActivityAt", () => {
  test("prefers amplifiedAt over the post's createdAt", () => {
    expect(
      nativeActivityAt(
        post("p", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")
      )
    ).toBe("2026-02-01T00:00:00.000Z");
    expect(nativeActivityAt(post("p", "2026-01-01T00:00:00.000Z"))).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(nativeActivityAt(reply("r", "2026-01-04T00:00:00.000Z"))).toBe(
      "2026-01-04T00:00:00.000Z"
    );
  });
});

describe("mergeProfileActivity", () => {
  test("interleaves amplified posts by amplification time", () => {
    const merged = mergeProfileActivity({
      external: {
        boundary: null,
        hasNextPage: false,
        items: [
          external("bsky-1", "2026-01-04T00:00:00.000Z"),
          external("bsky-2", "2026-01-02T00:00:00.000Z"),
        ],
      },
      native: {
        boundary: null,
        hasNextPage: false,
        items: [
          {
            kind: "post",
            value: post(
              "asm-1",
              "2020-01-01T00:00:00.000Z",
              "2026-01-03T00:00:00.000Z"
            ),
          },
          { kind: "post", value: post("asm-2", "2026-01-01T00:00:00.000Z") },
        ],
      },
    });
    expect(ids(merged.items)).toEqual([
      "external:bsky-1",
      "post:asm-1",
      "external:bsky-2",
      "post:asm-2",
    ]);
    expect(merged.advanceNative).toBe(false);
    expect(merged.advanceExternal).toBe(false);
  });

  test("pages only the source holding the newest boundary", () => {
    const merged = mergeProfileActivity({
      external: {
        boundary: "2026-01-02T00:00:00.000Z",
        hasNextPage: true,
        items: [
          external("bsky-1", "2026-01-06T00:00:00.000Z"),
          external("bsky-2", "2026-01-02T00:00:00.000Z"),
        ],
      },
      native: {
        boundary: "2026-01-04T00:00:00.000Z",
        hasNextPage: true,
        items: [
          { kind: "reply", value: reply("r-1", "2026-01-05T00:00:00.000Z") },
          { kind: "reply", value: reply("r-2", "2026-01-04T00:00:00.000Z") },
        ],
      },
    });
    expect(ids(merged.items)).toEqual(["external:bsky-1", "reply:r-1"]);
    expect(merged.advanceNative).toBe(true);
    expect(merged.advanceExternal).toBe(false);
  });

  test("shows nothing until the Bluesky first page lands", () => {
    const merged = mergeProfileActivity({
      external: { hasNextPage: false, items: [], pending: true },
      native: {
        hasNextPage: false,
        items: [
          { kind: "reply", value: reply("r-1", "2026-01-05T00:00:00.000Z") },
        ],
      },
    });
    expect(merged.items).toEqual([]);
    expect(merged.advanceNative).toBe(false);
  });

  test("passes native rows through when Bluesky is off", () => {
    const merged = mergeProfileActivity({
      external: { hasNextPage: false, items: [] },
      native: {
        boundary: "2026-01-04T00:00:00.000Z",
        hasNextPage: true,
        items: [
          { kind: "post", value: post("asm-1", "2026-01-05T00:00:00.000Z") },
        ],
      },
    });
    expect(ids(merged.items)).toEqual(["post:asm-1"]);
    expect(merged.advanceNative).toBe(true);
  });
});
