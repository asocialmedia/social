import { describe, expect, test } from "bun:test";

import { rankFeed } from "./rank-feed";

interface FeedPost {
  authorId: string;
  id: string;
}

function candidate(
  id: string,
  score: number,
  authorId = `author-${id}`
): {
  post: FeedPost;
  score: number;
} {
  return { post: { authorId, id }, score };
}

const CONFIG = { pageSize: 10 };

// Longest streak of back-to-back posts by one author in a ranked page.
function maxRun(posts: FeedPost[]): number {
  let longest = 0;
  let current = 0;
  let last: string | null = null;
  for (const post of posts) {
    current = post.authorId === last ? current + 1 : 1;
    last = post.authorId;
    longest = Math.max(longest, current);
  }
  return longest;
}

describe("rankFeed", () => {
  test("orders purely by score when authors are all distinct", () => {
    const ranked = rankFeed(
      [candidate("a", 10), candidate("b", 50), candidate("c", 30)],
      CONFIG
    );
    expect(ranked.map((post) => post.id)).toEqual(["b", "c", "a"]);
  });

  test("breaks score ties deterministically by ascending id", () => {
    const ranked = rankFeed(
      [candidate("zeta", 42), candidate("alpha", 42), candidate("mid", 42)],
      CONFIG
    );
    expect(ranked.map((post) => post.id)).toEqual(["alpha", "mid", "zeta"]);
  });

  test("is deterministic across repeated calls with identical inputs", () => {
    const candidates = [
      candidate("p1", 90),
      candidate("p2", 90),
      candidate("p3", 80),
      candidate("p4", 70),
    ];
    const first = rankFeed(candidates, CONFIG);
    const second = rankFeed([...candidates].toReversed(), CONFIG);
    expect(first.map((post) => post.id)).toEqual(second.map((post) => post.id));
  });

  test("never places more than two posts by one author consecutively", () => {
    const ranked = rankFeed(
      [
        candidate("a1", 100, "loud"),
        candidate("a2", 99, "loud"),
        candidate("a3", 98, "loud"),
        candidate("a4", 97, "loud"),
        candidate("b1", 5, "quiet"),
      ],
      CONFIG
    );
    // "quiet" (score 5) breaks the loud streak after two slots.
    expect(ranked.map((post) => post.id)).toEqual([
      "a1",
      "a2",
      "b1",
      "a3",
      "a4",
    ]);
    expect(maxRun(ranked)).toBeLessThanOrEqual(2);
  });

  test("caps any single author at the configured share of the page", () => {
    // Interleave scores so the streak rule never binds and the share cap is
    // what limits the dominant author.
    const candidates = [
      ...Array.from({ length: 9 }, (_, i) =>
        candidate(`dom${i}`, 100 - 2 * i, "dominant")
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        candidate(`filler${i}`, 99 - 2 * i, `author-${i}`)
      ),
    ];
    const ranked = rankFeed(candidates, { pageSize: 20 });
    const dominantCount = ranked.filter(
      (post) => post.authorId === "dominant"
    ).length;
    // 30% of a 20-slot page floors to exactly 6; the surplus pool lets
    // diversity hold without shortening the page.
    expect(dominantCount).toBe(6);
    expect(ranked).toHaveLength(20);
  });

  test("fills the page completely even from a single-author pool", () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      candidate(`solo${i}`, 100 - i, "only-author")
    );
    const ranked = rankFeed(candidates, { pageSize: 20 });
    // Diversity is best-effort: completeness always wins over an empty page.
    expect(ranked).toHaveLength(20);
  });

  test("returns fewer than pageSize only when candidates run out", () => {
    const ranked = rankFeed([candidate("x", 1), candidate("y", 2)], CONFIG);
    expect(ranked).toHaveLength(2);
  });

  test("respects custom diversity config", () => {
    const candidates = [
      candidate("a1", 30, "same"),
      candidate("a2", 29, "same"),
      candidate("a3", 28, "same"),
      candidate("b1", 3, "other"),
    ];
    const strict = rankFeed(candidates, {
      maxConsecutivePerAuthor: 1,
      pageSize: 10,
    });
    // Pool (4) is smaller than the page, so completeness appends the last
    // same-author leftover after the diversity-ordered prefix.
    expect(strict.map((post) => post.id)).toEqual(["a1", "b1", "a2", "a3"]);

    const loose = rankFeed(candidates, {
      maxConsecutivePerAuthor: 10,
      maxSingleAuthorShare: 1,
      pageSize: 10,
    });
    expect(loose.map((post) => post.id)).toEqual(["a1", "a2", "a3", "b1"]);
  });

  test("handles an empty candidate list", () => {
    expect(rankFeed([], CONFIG)).toEqual([]);
  });
});
