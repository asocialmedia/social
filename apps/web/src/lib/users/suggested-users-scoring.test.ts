import { describe, expect, test } from "bun:test";

import {
  buildViewerInterests,
  diversifyRanked,
  rankCandidates,
  scoreCandidate,
} from "./suggested-users-scoring";
import type { SuggestionCandidate } from "./suggested-users-scoring";

const mkCandidate = (aura: number, id: string) =>
  ({ aura, id }) as unknown as SuggestionCandidate;

describe("suggested-users-scoring", () => {
  describe("scoreCandidate", () => {
    const baseInterests = buildViewerInterests(
      ["followed1", "followed2"],
      ["photography", "music"],
      ["photography"]
    );

    test("mutuals heavily boost score", () => {
      const withMutual: SuggestionCandidate = {
        aura: 10,
        createdAt: new Date(),
        followerCount: 5,
        id: "1",
        mutualCount: 5,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: null,
        tagOverlap: 0,
      };
      const withoutMutual: SuggestionCandidate = {
        aura: 10,
        createdAt: new Date(),
        followerCount: 5,
        id: "2",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: null,
        tagOverlap: 0,
      };
      // Use deterministic weights without jitter for test
      const scoreWith = scoreCandidate(withMutual, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      const scoreWithout = scoreCandidate(withoutMutual, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(scoreWith).toBeGreaterThan(scoreWithout);
      expect(scoreWith - scoreWithout).toBeGreaterThan(10);
    });

    test("tag overlap boosts score", () => {
      const withTags: SuggestionCandidate = {
        aura: 10,
        createdAt: new Date(),
        followerCount: 5,
        id: "1",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: null,
        tagOverlap: 3,
      };
      const withoutTags: SuggestionCandidate = {
        aura: 10,
        createdAt: new Date(),
        followerCount: 5,
        id: "2",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: null,
        tagOverlap: 0,
      };
      const s1 = scoreCandidate(withTags, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      const s2 = scoreCandidate(withoutTags, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(s1).toBeGreaterThan(s2);
    });

    test("recent activity boosts, dormant penalizes", () => {
      const recent: SuggestionCandidate = {
        aura: 10,
        createdAt: new Date(),
        followerCount: 5,
        id: "1",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        tagOverlap: 0,
      };
      const dormant: SuggestionCandidate = {
        aura: 10,
        createdAt: new Date(),
        followerCount: 5,
        id: "2",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: new Date(Date.now() - 100 * 24 * 3600 * 1000),
        tagOverlap: 0,
      };
      const sRecent = scoreCandidate(recent, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      const sDormant = scoreCandidate(dormant, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(sRecent).toBeGreaterThan(sDormant);
    });

    test("negative aura does not crash and scores lower than positive", () => {
      const negative: SuggestionCandidate = {
        aura: -10,
        createdAt: new Date(),
        followerCount: 5,
        id: "1",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: null,
        tagOverlap: 0,
      };
      const positive: SuggestionCandidate = {
        aura: 100,
        createdAt: new Date(),
        followerCount: 5,
        id: "2",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 1,
        recentPostAt: null,
        tagOverlap: 0,
      };
      const sNeg = scoreCandidate(negative, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      const sPos = scoreCandidate(positive, baseInterests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(sPos).toBeGreaterThan(sNeg);
    });
  });

  describe("rankCandidates", () => {
    test("ranks by score descending", () => {
      const interests = buildViewerInterests([], [], []);
      const candidates: SuggestionCandidate[] = [
        {
          aura: 1,
          createdAt: new Date(),
          followerCount: 1,
          id: "low",
          mutualCount: 0,
          mutualFollowers: [],
          postCount: 0,
          recentPostAt: null,
          tagOverlap: 0,
        },
        {
          aura: 1000,
          createdAt: new Date(),
          followerCount: 100,
          id: "high",
          mutualCount: 5,
          mutualFollowers: [
            { avatarUrl: null, displayName: "A", username: "a" },
          ],
          postCount: 10,
          recentPostAt: new Date(),
          tagOverlap: 3,
        },
      ];
      const ranked = rankCandidates(candidates, interests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(ranked[0].id).toBe("high");
      expect(ranked[1].id).toBe("low");
      expect(ranked[0].reasons.length).toBeGreaterThan(0);
    });

    test("generates human readable reasons", () => {
      const interests = buildViewerInterests([], [], []);
      const candidate: SuggestionCandidate = {
        aura: 100,
        createdAt: new Date(),
        followerCount: 10,
        id: "1",
        mutualCount: 2,
        mutualFollowers: [
          { avatarUrl: null, displayName: "Alice", username: "alice" },
          { avatarUrl: null, displayName: "Bob", username: "bob" },
        ],
        postCount: 5,
        recentPostAt: new Date(),
        tagOverlap: 0,
      };
      const [ranked] = rankCandidates([candidate], interests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(ranked.reasons[0]).toContain("Followed by");
    });

    test("generates topic-specific interest match reasons", () => {
      const interests = buildViewerInterests([], [], []);
      const candidate: SuggestionCandidate = {
        aura: 50,
        createdAt: new Date(),
        followerCount: 10,
        matchedTopic: "porsche-911",
        mutualCount: 0,
        mutualFollowers: [],
        postCount: 5,
        recentPostAt: new Date(),
        tagOverlap: 2,
      };
      const [ranked] = rankCandidates([candidate], interests, {
        activity: 0.8,
        diversityJitter: 0,
        mutual: 4,
        popularity: 1.2,
        recency: 1.8,
        tagOverlap: 2.5,
      });
      expect(ranked.reasons).toContain("Shares your passion for Porsche 911");
    });
  });

  describe("diversifyRanked", () => {
    test("interleaves buckets to avoid mono-aura", () => {
      const ranked = [
        mkCandidate(5000, "h1"),
        mkCandidate(4000, "h2"),
        mkCandidate(500, "m1"),
        mkCandidate(400, "m2"),
        mkCandidate(10, "l1"),
        mkCandidate(5, "l2"),
      ] as unknown as (SuggestionCandidate & { score: number })[];
      // Simulate already ranked order
      const diversified = diversifyRanked(
        ranked as unknown as (SuggestionCandidate & { score: number })[],
        4
      );
      // Should contain at least one from each bucket if possible
      const ids = diversified.map((d) => (d as unknown as { id: string }).id);
      expect(ids).toContain("h1");
      expect(ids.length).toBe(4);
    });

    test("returns original if not enough to diversify", () => {
      const ranked = [
        mkCandidate(10, "l1"),
        mkCandidate(5, "l2"),
      ] as unknown as (SuggestionCandidate & { score: number })[];
      expect(
        diversifyRanked(
          ranked as unknown as (SuggestionCandidate & { score: number })[],
          4
        ).length
      ).toBe(2);
    });
  });

  describe("buildViewerInterests", () => {
    test("builds top tags from frequency", () => {
      const interests = buildViewerInterests(
        ["a", "b"],
        ["js", "js", "rust", "js"],
        ["rust"]
      );
      expect(interests.followedIds.has("a")).toBe(true);
      expect(interests.topTags.has("js")).toBe(true);
      expect(interests.tagFrequency.get("js")).toBe(3);
    });

    test("handles empty inputs", () => {
      const interests = buildViewerInterests([], [], []);
      expect(interests.followedIds.size).toBe(0);
      expect(interests.topTags.size).toBe(0);
    });
  });
});
