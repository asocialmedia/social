import { describe, expect, test } from "bun:test";

import type { FeedPost } from "@/features/feed/lib/feed-types";

import { CommunityPageCache, communityMediaUrl } from "./community-page-cache";

function post(id: string): FeedPost {
  return {
    _count: { bookmarks: 0, comments: 0, responses: 0, vote: 0 },
    attachments: [],
    bookmarks: [],
    createdAt: "2026-01-01",
    id,
    mentions: [],
    tags: [],
    userId: "u",
    vote: [],
  };
}
describe("community feed retention", () => {
  test("coalesces overlapping loads and reuses an unchanged sort without refetching", async () => {
    const cache = new CommunityPageCache();
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve({ nextCursor: "next", posts: [post("a")] });
    };
    const first = cache.load("user:community:new", load);
    const overlap = cache.load("user:community:new", load);
    expect(first).toBe(overlap);
    await first;
    await cache.load("user:community:new", load);
    expect(calls).toBe(1);
    await cache.load("user:community:new", load, true);
    expect(calls).toBe(2);
    expect(cache.get("other-user:community:new")).toBeNull();
  });
  test("a failed refresh retains the page and a retry can recover", async () => {
    const cache = new CommunityPageCache();
    await cache.load("page", () =>
      Promise.resolve({ nextCursor: "next", posts: [post("a")] })
    );
    await expect(
      cache.load("page", () => Promise.reject(new Error("offline")), true)
    ).rejects.toThrow("offline");
    expect(cache.get("page")?.posts[0]?.id).toBe("a");
    expect(cache.pending.size).toBe(0);
    expect(
      await cache.load(
        "page",
        () => Promise.resolve({ nextCursor: null, posts: [] }),
        true
      )
    ).toEqual({ nextCursor: null, posts: [] });
  });
  test("paging deduplicates, removals survive switching sorts, and the cache is bounded", async () => {
    const cache = new CommunityPageCache();
    await cache.load("new", () =>
      Promise.resolve({ nextCursor: "x", posts: [post("a")] })
    );
    expect(
      cache
        .append("new", {
          nextCursor: null,
          posts: [post("a"), post("b"), post("b")],
        })
        .posts.map((row) => row.id)
    ).toEqual(["a", "b"]);
    await cache.load("top", () =>
      Promise.resolve({ nextCursor: null, posts: [post("b")] })
    );
    cache.removePost("b");
    expect(cache.get("new")?.posts.map((row) => row.id)).toEqual(["a"]);
    expect(cache.get("top")?.posts).toEqual([]);
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        cache.load(`scope-${i}`, async () => {
          await Promise.resolve();
          return { nextCursor: null, posts: [] };
        })
      )
    );
    expect(cache.entries.size).toBe(32);
  });
  test("expiration and absolute banner URLs do not drift", () => {
    const cache = new CommunityPageCache();
    cache.entries.set("page", {
      page: { nextCursor: null, posts: [] },
      savedAt: 100,
    });
    expect(cache.get("page", 1_800_100)).toBeNull();
    expect(
      communityMediaUrl("https://images.test/banner.webp", "https://api.test")
    ).toBe("https://images.test/banner.webp");
    expect(communityMediaUrl("/api/media/banner", "https://api.test/")).toBe(
      "https://api.test/api/media/banner"
    );
    expect(
      communityMediaUrl("//images.test/banner", "https://api.test")
    ).toBeNull();
  });
});
