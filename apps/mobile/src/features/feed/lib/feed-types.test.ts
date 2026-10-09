import { describe, expect, test } from "bun:test";

import {
  extractInlineMeta,
  filterFeedPosts,
  findUnseenItems,
  findUnseenRankedItems,
  formatRelativeDate,
  getUserVote,
  groupPostsIntoThreads,
  insertionOrder,
  isBookmarkedByUser,
  normalizePostData,
  normalizePostsData,
  orderByIndex,
  sortPostsNewest,
} from "./feed-types";
import type { FeedPost } from "./feed-types";
import { formatFileName } from "./media-url";
import { ViewBatcher } from "./view-batcher";

function post(id: string, extra: Partial<FeedPost> = {}): FeedPost {
  return {
    _count: { bookmarks: 0, comments: 0, responses: 0, vote: 0 },
    attachments: [],
    bookmarks: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    id,
    mentions: [],
    tags: [],
    userId: "u",
    vote: [],
    ...extra,
  };
}

describe("insertionOrder", () => {
  test("long feeds use bounded comparisons and preserve input order on ties", () => {
    const input = Array.from({ length: 4096 }, (_, id) => ({
      id,
      rank: id % 8,
    }));
    let comparisons = 0;
    const ordered = insertionOrder(input, (left, right) => {
      comparisons += 1;
      return left.rank - right.rank;
    });
    expect(comparisons).toBeLessThan(4096 * 12);
    expect(
      ordered.filter((item) => item.rank === 0).map((item) => item.id)
    ).toEqual(input.filter((item) => item.rank === 0).map((item) => item.id));
    expect(input[0]?.id).toBe(0);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]?.rank).toBeGreaterThanOrEqual(
        ordered[index - 1]?.rank ?? 0
      );
    }
  });
  test("orders without Array.sort", () => {
    expect(insertionOrder([3, 1, 2], (a, b) => a - b)).toEqual([1, 2, 3]);
    expect(insertionOrder([1, 2, 3], (a, b) => a - b)).toEqual([1, 2, 3]);
    expect(insertionOrder([], (a, b) => a - b)).toEqual([]);
  });

  test("is stable for equal keys", () => {
    const items = [
      { id: "a", rank: 1 },
      { id: "b", rank: 1 },
      { id: "c", rank: 0 },
    ];
    expect(
      insertionOrder(items, (x, y) => x.rank - y.rank).map((item) => item.id)
    ).toEqual(["c", "a", "b"]);
  });

  test("orders FlatList view tokens without Array.sort or toSorted", () => {
    const originalToSorted = Array.prototype.toSorted;
    // oxlint-disable-next-line no-extend-native -- simulate the Hermes runtime
    Object.defineProperty(Array.prototype, "toSorted", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      const items = [
        { id: "b", index: 2 },
        { id: "a", index: 0 },
        { id: "missing", index: null },
        { id: "c", index: 1 },
      ];
      expect(orderByIndex(items).map((item) => item.id)).toEqual([
        "a",
        "missing",
        "c",
        "b",
      ]);
    } finally {
      // oxlint-disable-next-line no-extend-native -- restore the test runtime
      Object.defineProperty(Array.prototype, "toSorted", {
        configurable: true,
        value: originalToSorted,
        writable: true,
      });
    }
  });
});

describe("normalizePostData", () => {
  test("patches missing relations and counts", () => {
    const bare = { createdAt: "", id: "x", userId: "u" } as FeedPost;
    const normalized = normalizePostData(bare);
    expect(normalized.attachments).toEqual([]);
    expect(normalized.bookmarks).toEqual([]);
    expect(normalized._count).toEqual({
      bookmarks: 0,
      comments: 0,
      responses: 0,
      vote: 0,
    });
  });

  test("returns the same ref when clean", () => {
    const clean = post("x");
    expect(normalizePostData(clean)).toBe(clean);
  });

  test("normalizePostsData unwraps post wrappers", () => {
    const wrapped = { post: post("x") } as unknown as FeedPost;
    expect(normalizePostsData([wrapped])[0]?.id).toBe("x");
  });
});

describe("filterFeedPosts", () => {
  test("drops falsy, excluded and dismissed rows", () => {
    const posts = [post("a"), post("b"), post("c")];
    expect(
      filterFeedPosts(posts, {
        dismissedIds: new Set(["c"]),
        excludeIds: new Set(["b"]),
      }).map((item) => item.id)
    ).toEqual(["a"]);
    expect(
      filterFeedPosts(posts, { excludePostId: "a" }).map((item) => item.id)
    ).toEqual(["b", "c"]);
  });
});

describe("sortPostsNewest", () => {
  test("orders newest first with id tiebreak", () => {
    const old = post("b", { createdAt: "2024-01-01T00:00:00.000Z" });
    const young = post("a", { createdAt: "2024-02-01T00:00:00.000Z" });
    expect(sortPostsNewest([old, young]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("groupPostsIntoThreads", () => {
  test("chains parent and child present in the slice", () => {
    const parent = post("p");
    const child = post("c", { parentPostId: "p" });
    const groups = groupPostsIntoThreads([child, parent]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.posts.map((item) => item.id)).toEqual(["p", "c"]);
  });

  test("keeps orphans as their own group", () => {
    const orphan = post("o", { parentPostId: "missing" });
    const groups = groupPostsIntoThreads([orphan, post("s")]);
    expect(groups).toHaveLength(2);
  });

  test("returns nothing for an empty feed", () => {
    expect(groupPostsIntoThreads([])).toEqual([]);
  });
});

describe("findUnseenItems", () => {
  test("collects the head until the first known id", () => {
    const fresh = [post("n2"), post("n1"), post("old")];
    expect(
      findUnseenItems(fresh, new Set(["old"])).map((item) => item.id)
    ).toEqual(["n2", "n1"]);
    expect(findUnseenItems(fresh, new Set(["n2"]))).toEqual([]);
  });
});

describe("findUnseenRankedItems", () => {
  test("keeps a new post that ranked below posts the reader already has", () => {
    // A score-ordered feed can put an arriving post eighth, so the leading-run
    // walk would have stopped at the first known id and dropped it entirely.
    const fresh = [post("old-1"), post("old-2"), post("arrived"), post("o3")];
    expect(
      findUnseenRankedItems(fresh, new Set(["old-1", "old-2", "o3"])).map(
        (item) => item.id
      )
    ).toEqual(["arrived"]);
  });

  test("returns nothing when every ranked row is already on screen", () => {
    const fresh = [post("a"), post("b")];
    expect(findUnseenRankedItems(fresh, new Set(["a", "b"]))).toEqual([]);
  });

  test("returns every row when the reader has nothing yet", () => {
    const fresh = [post("a"), post("b")];
    expect(
      findUnseenRankedItems(fresh, new Set<string>()).map((item) => item.id)
    ).toEqual(["a", "b"]);
  });
});

describe("isBookmarkedByUser + getUserVote", () => {
  test("reads viewer-scoped relations", () => {
    const item = post("x", {
      bookmarks: [{ userId: "me" }],
      vote: [{ userId: "me", value: -1 }],
    });
    expect(isBookmarkedByUser(item, "me")).toBe(true);
    expect(isBookmarkedByUser(item, "other")).toBe(false);
    expect(getUserVote(item)).toBe(-1);
    expect(getUserVote(post("y"))).toBe(0);
  });
});

describe("ViewBatcher", () => {
  test("buffers marks and flushes once", async () => {
    const calls: string[][] = [];
    const batcher = new ViewBatcher(async (ids: string[]) => {
      calls.push(ids);
      await Promise.resolve();
      return {};
    });
    batcher.mark("a", { apiBase: "http://x" });
    batcher.mark("a", { apiBase: "http://x" });
    batcher.mark("b", { apiBase: "http://x" });
    expect(batcher.size).toBe(2);
    await batcher.flush();
    expect(calls).toEqual([["a", "b"]]);
    expect(batcher.size).toBe(0);
  });

  test("flush of an empty buffer sends nothing", async () => {
    let called = false;
    const batcher = new ViewBatcher(async () => {
      called = true;
      await Promise.resolve();
      return {};
    });
    await expect(batcher.flush()).resolves.toEqual({});
    expect(called).toBe(false);
  });
});

describe("formatRelativeDate", () => {
  test("renders relative buckets", () => {
    expect(
      formatRelativeDate(new Date(Date.now() - 10_000).toISOString())
    ).toBe("just now");
    expect(
      formatRelativeDate(new Date(Date.now() - 5 * 60_000).toISOString())
    ).toBe("5m");
    expect(
      formatRelativeDate(new Date(Date.now() - 3 * 3_600_000).toISOString())
    ).toBe("3h");
  });

  test("rejects garbage", () => {
    expect(formatRelativeDate("nope")).toBe("");
  });
});

describe("extractInlineMeta", () => {
  test("collects lowercase usernames and tags", () => {
    expect(extractInlineMeta("hi @Octo #Ship #ship")).toEqual({
      tags: new Set(["ship"]),
      usernames: new Set(["octo"]),
    });
  });
});

describe("formatFileName", () => {
  test("strips storage prefixes and decodes", () => {
    expect(formatFileName("uploads/abc123-my%20song.mp3")).toBe("my song.mp3");
    expect(formatFileName()).toBe("Unknown file");
    expect(formatFileName("")).toBe("Unknown file");
  });
});

describe("ViewBatcher drain + retry", () => {
  test("drains remainder past MAX_BATCH", async () => {
    const seen: string[][] = [];
    const batcher = new ViewBatcher(async (ids: string[]) => {
      seen.push(ids);
      await Promise.resolve();
      return {};
    });
    for (let index = 0; index < 105; index += 1) {
      batcher.mark(`p${index}`, { apiBase: "http://x" });
    }
    await batcher.flush();
    await Bun.sleep(1500);
    const total = seen.flat().length;
    expect(total).toBe(105);
  });

  test("requeues a failed batch, then drops after repeated failures", async () => {
    let calls = 0;
    const batcher = new ViewBatcher(
      async (): Promise<Record<string, number>> => {
        calls += 1;
        await Promise.resolve();
        throw new Error("down");
      }
    );
    batcher.mark("a", { apiBase: "http://x" });
    await batcher.flush();
    expect(batcher.size).toBe(1);
    expect(calls).toBe(1);
  });
});
