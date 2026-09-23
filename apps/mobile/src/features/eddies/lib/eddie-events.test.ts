import { describe, expect, test } from "bun:test";

import type { FeedComment } from "@/features/feed/lib/feed-api";

import { emitEddieCreated, subscribeEddieCreated } from "./eddie-events";

const eddie: FeedComment = { createdAt: "2026-01-01T00:00:00Z", id: "c1" };

describe("eddie created bus", () => {
  test("delivers to the matching post only", () => {
    const seen: string[] = [];
    const off = subscribeEddieCreated("post-a", (comment) =>
      seen.push(comment.id)
    );
    emitEddieCreated("post-b", eddie);
    emitEddieCreated("post-a", eddie);
    expect(seen).toEqual(["c1"]);
    off();
  });

  test("stops delivering after unsubscribe", () => {
    const seen: string[] = [];
    const off = subscribeEddieCreated("post-a", (comment) =>
      seen.push(comment.id)
    );
    off();
    emitEddieCreated("post-a", eddie);
    expect(seen).toEqual([]);
  });
});
