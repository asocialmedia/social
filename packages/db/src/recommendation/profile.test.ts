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

  test("handles negative signals (downvote/hide) separately from positive signals", () => {
    const profile = buildUserProfile([
      signal({
        authorId: "good-author",
        kind: "bookmark",
        tags: ["typescript"],
      }),
      signal({ authorId: "bad-author", kind: "downvote", tags: ["spam"] }),
      signal({ authorId: "annoying-author", kind: "hide", tags: ["crypto"] }),
    ]);

    expect(profile.authorWeights["good-author"]).toBe(1);
    const bad = profile.negativeAuthorWeights?.["bad-author"];
    const annoying = profile.negativeAuthorWeights?.["annoying-author"];
    const spam = profile.negativeTagWeights?.["spam"];
    const crypto = profile.negativeTagWeights?.["crypto"];
    for (const v of [bad, annoying, spam, crypto]) {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(0.9);
    }
    // hide produces stronger penalty than downvote but neither reaches zeroing threshold
    expect(annoying).toBeGreaterThan(bad ?? 0);
    expect(crypto).toBeGreaterThan(spam ?? 0);
  });

  test("detects topic and entity affinities dynamically from engagement signals", () => {
    const profile = buildUserProfile([
      signal({ kind: "bookmark", tags: ["coding", "linux", "homelab"] }),
      signal({ kind: "comment", tags: ["anime", "manga"] }),
      signal({ kind: "upvote", tags: ["meme", "funny"] }),
    ]);

    expect(profile.topicAffinities?.linux).toBeGreaterThan(0);
    expect(profile.topicAffinities?.anime).toBeGreaterThan(0);
    expect(profile.topicAffinities?.meme).toBeGreaterThan(0);
    expect(profile.summary?.topTags.length).toBeGreaterThan(0);
  });

  test("tracks format preferences for video, image, audio, and text", () => {
    const profile = buildUserProfile([
      signal({ hasVideo: true, kind: "bookmark", tags: ["clips"] }),
      signal({ hasVideo: true, kind: "upvote", tags: ["clips"] }),
      signal({ hasImage: true, kind: "bookmark", tags: ["art"] }),
    ]);

    expect(profile.formatAffinities?.video).toBeGreaterThan(
      profile.formatAffinities?.image ?? 0
    );
    expect(profile.summary?.preferredFormat).toBe("video");
  });

  test("user's own posts and gusts shape topics, tags, and format preference without self-authoring", () => {
    const profile = buildUserProfile([
      signal({
        authorId: "me",
        hasVideo: true,
        kind: "ownPost",
        tags: ["homelab", "linux", "proxmox"],
      }),
      signal({
        authorId: "me",
        hasImage: true,
        kind: "ownGust",
        tags: ["anime", "cosplay"],
      }),
    ]);

    expect(profile.authorWeights["me"]).toBeUndefined();
    expect(profile.tagWeights["homelab"]).toBeGreaterThan(0);
    expect(profile.tagWeights["anime"]).toBeGreaterThan(0);
    expect(profile.topicAffinities?.homelab).toBeGreaterThan(0);
    expect(profile.topicAffinities?.anime).toBeGreaterThan(0);
    expect(profile.formatAffinities?.video).toBeGreaterThan(0);
  });

  test("incorporates user search history signals into persona", () => {
    const profile = buildUserProfile([
      signal({ kind: "search", tags: ["cyberpunk", "anime"] }),
    ]);

    expect(profile.tagWeights["cyberpunk"]).toBeGreaterThan(0);
    expect(profile.tagWeights["anime"]).toBeGreaterThan(0);
    expect(profile.topicAffinities?.cyberpunk).toBeGreaterThan(0);
  });

  test("automatically evolves taste over time with recency decay (nature -> anime -> tech)", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const threeWeeksAgo = new Date(now.getTime() - 21 * 24 * 3600 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const today = new Date(now.getTime() - 2 * 3600 * 1000);

    const profile = buildUserProfile(
      [
        signal({
          createdAt: threeWeeksAgo,
          kind: "bookmark",
          tags: ["nature"],
        }),
        signal({ createdAt: oneWeekAgo, kind: "bookmark", tags: ["anime"] }),
        signal({ createdAt: today, kind: "bookmark", tags: ["tech"] }),
      ],
      { now }
    );

    // Today's tech has highest weight, 1-week-old anime is medium, 3-week-old nature has decayed to lowest
    expect(profile.tagWeights["tech"]).toBeGreaterThan(
      profile.tagWeights["anime"]
    );
    expect(profile.tagWeights["anime"]).toBeGreaterThan(
      profile.tagWeights["nature"]
    );
    expect(profile.summary?.dominantTopic).toBe("tech");
  });
});
