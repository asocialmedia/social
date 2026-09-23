import { describe, expect, test } from "bun:test";

import { gustVoteToast, planGustVote } from "./gust-vote";
import {
  addBurst,
  burstRotation,
  captionNeedsToggle,
  classifyTap,
  MAX_BURSTS,
  pullDistance,
  pullTriggers,
  shouldFetchMore,
  shouldMountVideo,
} from "./reel-gestures";

describe("planGustVote", () => {
  test("a rail tap on the active value clears it", () => {
    const plan = planGustVote({ aura: 5, userVote: 1 }, 1);
    expect(plan).toMatchObject({
      next: { aura: 4, userVote: 0 },
      noop: false,
      target: 0,
      toggleOff: true,
    });
  });

  test("switching from mute to amplify moves aura by two", () => {
    const plan = planGustVote({ aura: 5, userVote: -1 }, 1);
    expect(plan.next).toEqual({ aura: 7, userVote: 1 });
    expect(plan.toggleOff).toBe(false);
  });

  test("a double tap never un-amplifies", () => {
    const already = planGustVote({ aura: 5, userVote: 1 }, 1, true);
    expect(already.noop).toBe(true);
    expect(already.next).toEqual({ aura: 5, userVote: 1 });
    const fresh = planGustVote({ aura: 5, userVote: 0 }, 1, true);
    expect(fresh.next).toEqual({ aura: 6, userVote: 1 });
  });
});

describe("gustVoteToast", () => {
  test("uses web's copy for each transition", () => {
    const amplify = planGustVote({ aura: 0, userVote: 0 }, 1);
    expect(gustVoteToast(amplify, 0, "Ada")).toEqual({
      description: "Amplified Ada's gust, nice boost!",
      title: "+1 Aura",
    });
    const mute = planGustVote({ aura: 0, userVote: 0 }, -1);
    expect(gustVoteToast(mute, 0, "Ada")?.title).toBe("Muted");
    const unamplify = planGustVote({ aura: 1, userVote: 1 }, 1);
    expect(gustVoteToast(unamplify, 1, "Ada")?.title).toBe(
      "Amplification Removed"
    );
    const unmute = planGustVote({ aura: -1, userVote: -1 }, -1);
    expect(gustVoteToast(unmute, -1, "Ada")?.title).toBe("Mute Removed");
  });

  test("a no-op double tap stays silent", () => {
    const plan = planGustVote({ aura: 1, userVote: 1 }, 1, true);
    expect(gustVoteToast(plan, 1, "Ada")).toBeNull();
  });
});

describe("reel gestures", () => {
  test("pull resistance, cap and trigger match web", () => {
    expect(pullDistance(-10)).toBe(0);
    expect(pullDistance(100)).toBeCloseTo(45);
    expect(pullDistance(1000)).toBe(96);
    expect(pullTriggers(pullDistance(120))).toBe(false);
    expect(pullTriggers(pullDistance(125))).toBe(true);
  });

  test("a second tap inside 280ms is a double", () => {
    expect(classifyTap(1000, null)).toBe("single-pending");
    expect(classifyTap(1200, 1000)).toBe("double");
    expect(classifyTap(1280, 1000)).toBe("single-pending");
  });

  test("bursts fan out and cap at seven", () => {
    expect([0, 1, 2, 3, 4].map(burstRotation)).toEqual([-16, -8, 0, 8, 16]);
    let bursts = addBurst([], { id: 0, x: 0, y: 0 });
    for (let id = 1; id < 10; id += 1) {
      bursts = addBurst(bursts, { id, x: id, y: id });
    }
    expect(bursts).toHaveLength(MAX_BURSTS);
    expect(bursts[0]?.id).toBe(3);
  });

  test("only the active card and its neighbours mount a player", () => {
    expect(shouldMountVideo(4, 5)).toBe(true);
    expect(shouldMountVideo(6, 5)).toBe(true);
    expect(shouldMountVideo(7, 5)).toBe(false);
  });

  test("prefetches near the end, never twice at once", () => {
    const base = { hasNextPage: true, isFetching: false, total: 10 };
    expect(shouldFetchMore({ ...base, activeIndex: 3 })).toBe(false);
    expect(shouldFetchMore({ ...base, activeIndex: 7 })).toBe(true);
    expect(shouldFetchMore({ ...base, activeIndex: 7, isFetching: true })).toBe(
      false
    );
    expect(
      shouldFetchMore({ ...base, activeIndex: 9, hasNextPage: false })
    ).toBe(false);
  });

  test("the caption toggle appears past 80 characters", () => {
    expect(captionNeedsToggle("a".repeat(80))).toBe(false);
    expect(captionNeedsToggle("a".repeat(81))).toBe(true);
    expect(captionNeedsToggle(null)).toBe(false);
  });
});
