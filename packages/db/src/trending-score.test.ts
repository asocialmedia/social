import { describe, expect, test } from "bun:test";

import { computeTrendingScore } from "./trending-score";

const NOW = new Date("2026-08-23T12:00:00Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

describe("computeTrendingScore", () => {
  test("scores a brand-new post with zero engagement at exactly 0", () => {
    const score = computeTrendingScore({
      aura: 0,
      bookmarkCount: 0,
      commentCount: 0,
      createdAt: hoursAgo(0),
      now: NOW,
      viewCount: 0,
    });
    expect(score).toBe(0);
  });

  test("gives a fresh post with engagement a positive score", () => {
    const score = computeTrendingScore({
      aura: 10,
      bookmarkCount: 1,
      commentCount: 2,
      createdAt: hoursAgo(0),
      now: NOW,
      viewCount: 0,
    });
    // (10*1 + 2*3 + 1*5) / 2^1.5
    expect(score).toBeCloseTo(21 / 2 ** 1.5, 10);
  });

  test("clamps net-negative engagement to 0 so downvoted posts never trend", () => {
    const score = computeTrendingScore({
      aura: -50,
      bookmarkCount: 0,
      commentCount: 0,
      createdAt: hoursAgo(1),
      now: NOW,
      viewCount: 0,
    });
    expect(score).toBe(0);
  });

  test("negative aura is offset by stronger positive signals before clamping", () => {
    const score = computeTrendingScore({
      aura: -5,
      bookmarkCount: 2,
      commentCount: 0,
      createdAt: hoursAgo(0),
      now: NOW,
      viewCount: 0,
    });
    // (-5 + 2*5) = +5 after weighting, still trends.
    expect(score).toBeCloseTo(5 / 2 ** 1.5, 10);
  });

  test("ranks identical signals on newer posts above older posts", () => {
    const scoreOf = (ageHours: number) =>
      computeTrendingScore({
        aura: 40,
        bookmarkCount: 3,
        commentCount: 6,
        createdAt: hoursAgo(ageHours),
        now: NOW,
        viewCount: 0,
      });
    expect(scoreOf(1)).toBeGreaterThan(scoreOf(24));
    expect(scoreOf(24)).toBeGreaterThan(scoreOf(24 * 7));
  });

  test("lets a fresh modest post outrank a stale champion", () => {
    const fresh = computeTrendingScore({
      aura: 30,
      bookmarkCount: 2,
      commentCount: 4,
      createdAt: hoursAgo(2),
      now: NOW,
      viewCount: 0,
    });
    const stale = computeTrendingScore({
      aura: 5000,
      bookmarkCount: 100,
      commentCount: 200,
      createdAt: hoursAgo(24 * 30),
      now: NOW,
      viewCount: 0,
    });
    expect(fresh).toBeGreaterThan(stale);
  });

  test("decays monotonically as the same post ages", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const age of [0, 1, 2, 5, 12, 48, 168]) {
      const score = computeTrendingScore({
        aura: 100,
        bookmarkCount: 10,
        commentCount: 20,
        createdAt: hoursAgo(age),
        now: NOW,
        viewCount: 0,
      });
      expect(score).toBeLessThan(previous);
      expect(score).toBeGreaterThanOrEqual(0);
      previous = score;
    }
  });

  test("weights bookmarks > comments > aura > views per unit", () => {
    const scoreFor = (patch: {
      aura?: number;
      bookmarkCount?: number;
      commentCount?: number;
      viewCount?: number;
    }) =>
      computeTrendingScore({
        aura: 0,
        bookmarkCount: 0,
        commentCount: 0,
        createdAt: hoursAgo(0),
        now: NOW,
        viewCount: 0,
        ...patch,
      });
    const oneBookmark = scoreFor({ bookmarkCount: 1 });
    const oneComment = scoreFor({ commentCount: 1 });
    const oneAura = scoreFor({ aura: 1 });
    const oneView = scoreFor({ viewCount: 1 });
    expect(oneBookmark).toBeGreaterThan(oneComment);
    expect(oneComment).toBeGreaterThan(oneAura);
    expect(oneAura).toBeGreaterThan(oneView);
    // Exact ratios: 5 bookmarks == 3x... i.e. one bookmark equals five aura.
    expect(oneBookmark).toBeCloseTo(5 * oneAura, 12);
    expect(oneComment).toBeCloseTo(3 * oneAura, 12);
    expect(oneView).toBeCloseTo(0.05 * oneAura, 12);
  });

  test("treats a future createdAt (clock skew) as age zero without going negative", () => {
    const score = computeTrendingScore({
      aura: 10,
      bookmarkCount: 0,
      commentCount: 0,
      createdAt: new Date(NOW.getTime() + 5 * 3_600_000),
      now: NOW,
      viewCount: 0,
    });
    expect(score).toBeCloseTo(10 / 2 ** 1.5, 10);
  });

  test("defaults `now` to the current clock when omitted", () => {
    const justNow = new Date(Date.now() - 60_000);
    const score = computeTrendingScore({
      aura: 8,
      bookmarkCount: 0,
      commentCount: 0,
      createdAt: justNow,
      viewCount: 0,
    });
    expect(score).toBeGreaterThan(0);
    expect(Number.isFinite(score)).toBe(true);
  });

  test("is deterministic for identical inputs", () => {
    const input = {
      aura: 12,
      bookmarkCount: 4,
      commentCount: 9,
      createdAt: hoursAgo(6),
      now: NOW,
      viewCount: 0,
    };
    expect(computeTrendingScore(input)).toBe(computeTrendingScore(input));
  });
});
