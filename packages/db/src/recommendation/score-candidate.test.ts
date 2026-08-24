import { describe, expect, test } from "bun:test";

import { buildUserProfile } from "./profile";
import type { ProfileSignal } from "./profile";
import { scoreCandidate, scoreCandidateComponents } from "./score-candidate";
import type { CandidatePost } from "./score-candidate";

const NOW = new Date("2026-08-23T12:00:00Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function post(patch: Partial<CandidatePost>): CandidatePost {
  return {
    aura: 0,
    authorId: "author-1",
    bookmarkCount: 0,
    commentCount: 0,
    createdAt: hoursAgo(1),
    id: "p1",
    tags: [],
    ...patch,
  };
}

function signalsOf(...entries: [string, ProfileSignal["kind"], string[]][]) {
  return entries.map(([authorId, kind, tags]) => ({ authorId, kind, tags }));
}

// A signed-in user with zero recorded engagement.
const EMPTY_PROFILE = { authorWeights: {}, tagWeights: {} };

describe("scoreCandidate", () => {
  test("scores a cold profile post purely on freshness and traction", () => {
    const score = scoreCandidate(post({}), EMPTY_PROFILE, { now: NOW });
    // Freshness after 1h = 0.5^(1/12) -> ~19 points; traction log1p(0)=0.
    const expected = 0.5 ** (1 / 12) * 20;
    expect(score).toBeCloseTo(expected, 10);
    expect(score).toBeLessThan(20);
  });

  test("reaches the author-affinity cap when one author dominates the profile", () => {
    const profile = buildUserProfile([
      ...signalsOf(
        ["hot-author", "bookmark", []],
        ["other", "comment", []],
        ["other", "comment", []]
      ),
    ]);
    const components = scoreCandidateComponents(
      post({ authorId: "hot-author" }),
      profile,
      { now: NOW }
    );
    // hot-author holds 3/4 of engagement mass: far past the 0.2 saturation.
    expect(components.authorAffinity).toBe(1);
    expect(
      scoreCandidate(post({ authorId: "hot-author" }), profile, { now: NOW })
    ).toBeCloseTo(40 + 0.5 ** (1 / 12) * 20, 10);
  });

  test("a followed author gets the baseline affinity without any history", () => {
    const components = scoreCandidateComponents(post({}), EMPTY_PROFILE, {
      followedAuthorIds: new Set(["author-1"]),
      now: NOW,
    });
    expect(components.authorAffinity).toBe(0.4);
  });

  test("recorded affinity above the follow baseline wins over the baseline", () => {
    const profile = buildUserProfile(signalsOf(["author-1", "bookmark", []]));
    // Sole engagement: affinity share 1.0 -> capped at 1, above baseline 0.4.
    const components = scoreCandidateComponents(post({}), profile, {
      followedAuthorIds: new Set(["author-1"]),
      now: NOW,
    });
    expect(components.authorAffinity).toBe(1);
  });

  test("tag overlap saturates once a post's topics cover the profile mass", () => {
    const focused = buildUserProfile(signalsOf(["a", "bookmark", ["rust"]]));
    const matching = scoreCandidateComponents(
      post({ tags: ["rust"] }),
      focused,
      { now: NOW }
    );
    expect(matching.tagOverlap).toBe(1);

    // A user spread across four equal topics holds 0.25 mass per topic, so a
    // single-topic post lands below the 0.3 saturation point.
    const spread = buildUserProfile(
      signalsOf(
        ["a", "bookmark", ["rust"]],
        ["b", "bookmark", ["web"]],
        ["c", "bookmark", ["art"]],
        ["d", "bookmark", ["music"]]
      )
    );
    const partial = scoreCandidateComponents(
      post({ tags: ["music"] }),
      spread,
      { now: NOW }
    );
    expect(partial.tagOverlap).toBeCloseTo(0.25 / 0.3, 12);

    const everything = scoreCandidateComponents(
      post({ tags: ["rust", "web", "art", "music"] }),
      spread,
      { now: NOW }
    );
    expect(everything.tagOverlap).toBe(1);
  });

  test("untagged posts get zero topic overlap without crashing", () => {
    const profile = buildUserProfile(signalsOf(["a", "bookmark", ["rust"]]));
    const components = scoreCandidateComponents(post({}), profile, {
      now: NOW,
    });
    expect(components.tagOverlap).toBe(0);
  });

  test("freshness halves every 12 hours and floors at zero age", () => {
    const fresh = scoreCandidateComponents(
      post({ createdAt: hoursAgo(0) }),
      EMPTY_PROFILE,
      { now: NOW }
    );
    expect(fresh.freshness).toBe(1);
    const dayOld = scoreCandidateComponents(
      post({ createdAt: hoursAgo(24) }),
      EMPTY_PROFILE,
      { now: NOW }
    );
    expect(dayOld.freshness).toBeCloseTo(0.5 ** 2, 12);
    const future = scoreCandidateComponents(
      post({ createdAt: new Date(NOW.getTime() + 3_600_000) }),
      EMPTY_PROFILE,
      { now: NOW }
    );
    expect(future.freshness).toBe(1);
  });

  test("traction is log-scaled and clamps negatives", () => {
    const none = scoreCandidateComponents(post({ aura: -30 }), EMPTY_PROFILE, {
      now: NOW,
    });
    expect(none.traction).toBe(0);
    const tenX = scoreCandidateComponents(post({ aura: 100 }), EMPTY_PROFILE, {
      now: NOW,
    }).traction;
    const hundredX = scoreCandidateComponents(
      post({ aura: 1000 }),
      EMPTY_PROFILE,
      { now: NOW }
    ).traction;
    // Sublinear: 10x the aura does not come close to 10x the points.
    expect(hundredX / tenX).toBeLessThan(10 * (10 / tenX));
    expect(tenX).toBeGreaterThan(0);
    expect(hundredX).toBeGreaterThan(tenX);
  });

  test("total score never exceeds 100 and is additive at full saturation", () => {
    const profile = buildUserProfile(
      signalsOf(["author-1", "bookmark", ["rust"]])
    );
    const maxed = scoreCandidate(
      post({
        aura: 500,
        commentCount: 100,
        createdAt: hoursAgo(0),
        tags: ["rust"],
      }),
      profile,
      { followedAuthorIds: new Set(["author-1"]), now: NOW }
    );
    expect(maxed).toBeCloseTo(100, 10);
    expect(maxed).toBeLessThanOrEqual(100);
  });

  test("orders candidates by predicted interest for the given profile", () => {
    const profile = buildUserProfile(
      signalsOf(["liked-author", "bookmark", ["rust"]])
    );
    const ranked = [
      post({ id: "random-fresh" }),
      post({ createdAt: hoursAgo(6), id: "topic-match", tags: ["rust"] }),
      post({
        authorId: "liked-author",
        createdAt: hoursAgo(6),
        id: "author-match",
      }),
      post({ aura: 400, createdAt: hoursAgo(70), id: "stale-viral" }),
      post({ createdAt: hoursAgo(70), id: "stale-dead" }),
    ].map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, profile, { now: NOW }),
    }));

    const scoresById = Object.fromEntries(
      ranked.map((entry) => [entry.candidate.id, entry.score])
    );
    // Affinity and topic overlap lift matching posts above an equally fresh
    // random one.
    expect(scoresById["author-match"]).toBeGreaterThan(
      scoresById["random-fresh"]
    );
    expect(scoresById["topic-match"]).toBeGreaterThan(
      scoresById["random-fresh"]
    );
    // Traction still lifts a viral post above an identical-age dead one, even
    // though freshness dominates for a cold profile.
    expect(scoresById["stale-viral"]).toBeGreaterThan(scoresById["stale-dead"]);
  });

  test("two users with different histories order the same posts differently", () => {
    const rustUser = buildUserProfile(signalsOf(["a1", "bookmark", ["rust"]]));
    const webUser = buildUserProfile(signalsOf(["a2", "bookmark", ["web"]]));

    const rustPost = post({
      createdAt: hoursAgo(5),
      id: "rust-post",
      tags: ["rust"],
    });
    const webPost = post({
      createdAt: hoursAgo(5),
      id: "web-post",
      tags: ["web"],
    });

    expect(scoreCandidate(rustPost, rustUser, { now: NOW })).toBeGreaterThan(
      scoreCandidate(webPost, rustUser, { now: NOW })
    );
    expect(scoreCandidate(webPost, webUser, { now: NOW })).toBeGreaterThan(
      scoreCandidate(rustPost, webUser, { now: NOW })
    );
  });

  test("traction weights match the trending ranker (bookmark=5, comment=3)", () => {
    // Identical aura-equivalent raw traction must yield identical scores,
    // keeping For-You and trending in agreement on what engagement is worth.
    const byAura = scoreCandidateComponents(post({ aura: 15 }), EMPTY_PROFILE, {
      now: NOW,
    }).traction;
    const byBookmarks = scoreCandidateComponents(
      post({ bookmarkCount: 3 }),
      EMPTY_PROFILE,
      { now: NOW }
    ).traction;
    const byComments = scoreCandidateComponents(
      post({ commentCount: 5 }),
      EMPTY_PROFILE,
      { now: NOW }
    ).traction;
    expect(byBookmarks).toBe(byAura);
    expect(byComments).toBe(byAura);
  });

  test("author visibility weight scales the final score", () => {
    const candidate = post({ aura: 12, commentCount: 3, tags: ["x"] });
    const profile = buildUserProfile(signalsOf(["author-9", "comment", ["x"]]));
    const options = { followedAuthorIds: new Set(["author-9"]), now: NOW };

    const neutral = scoreCandidate(candidate, profile, options);
    // A negative-balance author at the 0.4 visibility floor.
    const penalized = scoreCandidate(candidate, profile, {
      ...options,
      authorVisibilityWeight: 0.4,
    });

    expect(penalized).toBeCloseTo(neutral * 0.4, 8);

    // Unknown authors default to neutral weighting.
    expect(scoreCandidate(candidate, profile, options)).toBe(
      scoreCandidate(candidate, profile, {
        ...options,
        authorVisibilityWeight: undefined,
      })
    );
  });

  test("is deterministic for identical inputs", () => {
    const candidate = post({ aura: 12, commentCount: 3, tags: ["x"] });
    const profile = buildUserProfile(signalsOf(["author-9", "comment", ["x"]]));
    const options = { followedAuthorIds: new Set(["author-9"]), now: NOW };
    expect(scoreCandidate(candidate, profile, options)).toBe(
      scoreCandidate(candidate, profile, options)
    );
  });
});
