import { beforeEach, describe, expect, test } from "bun:test";

import {
  MAX_SAVED_FEED_POSITIONS,
  useFeedPositionStore,
} from "./feed-position-store";

const position = (
  overrides: Partial<{ scrollTop: number; updatedAt: number }> = {}
) => ({
  anchorOffset: 0,
  anchorPostId: "post-1",
  scrollTop: 1200,
  updatedAt: 1000,
  ...overrides,
});

beforeEach(() => {
  useFeedPositionStore.getState().resetFeedPositions();
});

describe("feed position store", () => {
  test("saves and clears positions per key", () => {
    useFeedPositionStore.getState().saveFeedPosition("home:latest", position());
    expect(
      useFeedPositionStore.getState().positions["home:latest"]?.scrollTop
    ).toBe(1200);

    useFeedPositionStore.getState().clearFeedPosition("home:latest");
    expect(
      useFeedPositionStore.getState().positions["home:latest"]
    ).toBeUndefined();
  });

  test("evicts the stalest entries past capacity, never the one just saved", () => {
    const state = useFeedPositionStore.getState();
    for (let index = 0; index < MAX_SAVED_FEED_POSITIONS; index += 1) {
      state.saveFeedPosition(`key-${index}`, position({ updatedAt: index }));
    }
    expect(Object.keys(useFeedPositionStore.getState().positions)).toHaveLength(
      MAX_SAVED_FEED_POSITIONS
    );

    useFeedPositionStore
      .getState()
      .saveFeedPosition("new-key", position({ updatedAt: 0 }));
    const { positions } = useFeedPositionStore.getState();
    expect(Object.keys(positions)).toHaveLength(MAX_SAVED_FEED_POSITIONS);
    expect(positions["new-key"]).toBeDefined();
    // key-0 had the oldest timestamp, so it is the eviction victim.
    expect(positions["key-0"]).toBeUndefined();
    expect(positions["key-1"]).toBeDefined();
  });

  test("rehydration sanitizes hostile payloads", () => {
    const { merge } = useFeedPositionStore.persist.getOptions();
    expect(merge).toBeDefined();
    if (!merge) {
      return;
    }
    const current = useFeedPositionStore.getState();
    const merged = merge(
      {
        positions: {
          good: position(),
          "negative-scroll": position({ scrollTop: -50 }),
          "wrong-list": [1, 2, 3],
          "wrong-shape": { scrollTop: "far" },
        },
      },
      current
    );
    const { positions } = merged;
    expect(positions["good"]?.scrollTop).toBe(1200);
    expect(positions["negative-scroll"]?.scrollTop).toBe(0);
    expect(positions["wrong-list"]).toBeUndefined();
    expect(positions["wrong-shape"]).toBeUndefined();
  });
});
