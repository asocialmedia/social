import { describe, expect, test } from "bun:test";

import { buildUserProfile } from "./profile";
import type { ProfileSignal } from "./profile";

function signal(patch: Partial<ProfileSignal>): ProfileSignal {
  return { authorId: "author-1", kind: "amplify", tags: [], ...patch };
}

function sum(weights: Record<string, number>): number {
  return Object.values(weights).reduce((total, weight) => total + weight, 0);
}

describe("buildUserProfile", () => {
  test("returns empty maps for a user with no history", () => {
    const profile = buildUserProfile([]);
    expect(profile.authorWeights).toEqual({});
    expect(profile.tagWeights).toEqual({});
  });

  test("credits the engaged post's author and tags", () => {
    const profile = buildUserProfile([
      signal({ authorId: "a1", kind: "bookmark", tags: ["rust"] }),
    ]);
    expect(profile.authorWeights).toEqual({ a1: 1 });
    expect(profile.tagWeights).toEqual({ rust: 1 });
  });

  test("weights bookmark > comment = amplify > commentVote", () => {
    // Normalization hides kind weights in single-signal profiles, so compare
    // shares inside one mixed profile via per-topic tag mass.
    const profile = buildUserProfile([
      signal({ kind: "bookmark", tags: ["bookmark-topic"] }),
      signal({ kind: "comment", tags: ["comment-topic"] }),
      signal({ kind: "amplify", tags: ["amplify-topic"] }),
      signal({ kind: "commentVote", tags: ["vote-topic"] }),
    ]);
    const tagWeight = (topic: string) => profile.tagWeights[topic];
    expect(tagWeight("bookmark-topic")).toBeGreaterThan(
      tagWeight("comment-topic")
    );
    expect(tagWeight("comment-topic")).toBeCloseTo(
      tagWeight("amplify-topic"),
      12
    );
    expect(tagWeight("amplify-topic")).toBeGreaterThan(tagWeight("vote-topic"));
    expect(tagWeight("bookmark-topic") / tagWeight("vote-topic")).toBeCloseTo(
      3,
      10
    );
  });

  test("splits tag credit across distinct tags of one post", () => {
    const profile = buildUserProfile([
      signal({ kind: "bookmark", tags: ["rust", "web"] }),
    ]);
    // A bookmark weighs 3; each of the two distinct tags gets 1.5.
    expect(profile.tagWeights["rust"]).toBeCloseTo(0.5, 12);
    expect(profile.tagWeights["web"]).toBeCloseTo(0.5, 12);
  });

  test("dedupes repeated tags within one signal before splitting", () => {
    const profile = buildUserProfile([
      signal({ kind: "amplify", tags: ["rust", "rust"] }),
    ]);
    // Duplicate "rust" counts once: full weight lands on the single topic.
    expect(profile.tagWeights).toEqual({ rust: 1 });
  });

  test("accumulates across many signals into comparable shares", () => {
    const profile = buildUserProfile([
      signal({ authorId: "a1", kind: "bookmark", tags: ["rust"] }),
      signal({ authorId: "a2", kind: "comment", tags: ["rust"] }),
      signal({ authorId: "a3", kind: "commentVote", tags: ["web"] }),
    ]);
    expect(sum(profile.authorWeights)).toBeCloseTo(1, 12);
    expect(sum(profile.tagWeights)).toBeCloseTo(1, 12);
    // a1 holds 3 of 6 engagement mass, a2 2 of 6.
    expect(profile.authorWeights["a1"]).toBeCloseTo(0.5, 12);
    expect(profile.authorWeights["a2"]).toBeCloseTo(1 / 3, 12);
    // rust mass = 3 + 2 = 5 of 6.
    expect(profile.tagWeights["rust"]).toBeCloseTo(5 / 6, 12);
  });

  test("normalizes prolific histories to the same scale as quiet ones", () => {
    const prolific = buildUserProfile(
      Array.from({ length: 50 }, (_, i) =>
        signal({ authorId: `a${i % 10}`, kind: "bookmark", tags: ["t"] })
      )
    );
    const quiet = buildUserProfile([
      signal({ authorId: "x", kind: "bookmark", tags: ["t"] }),
    ]);
    // Both profiles are shares-of-attention: they sum to 1 no matter how much
    // (or little) the user engaged, so ranking stays comparable across users.
    expect(sum(prolific.authorWeights)).toBeCloseTo(1, 12);
    expect(sum(quiet.authorWeights)).toBeCloseTo(1, 12);
    expect(sum(prolific.tagWeights)).toBeCloseTo(1, 12);
    for (const weight of Object.values(prolific.authorWeights)) {
      expect(weight).toBeCloseTo(0.1, 12);
    }
  });

  test("skips signals without an author id", () => {
    const profile = buildUserProfile([signal({ authorId: "" })]);
    expect(profile.authorWeights).toEqual({});
    expect(profile.tagWeights).toEqual({});
  });
});
