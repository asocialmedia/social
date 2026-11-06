import { describe, expect, it } from "bun:test";

import {
  LIST_BATCH_UPDATE_MS,
  LIST_INITIAL_RENDER,
  LIST_RENDER_BATCH,
  LIST_VIRTUALIZATION_PROPS,
  LIST_WINDOW_SIZE,
} from "./list-virtualization";

// The feed measured 4,443 native views at rest and 6,752 after 8 swipes on RN
// defaults, passing 1.2 GB PSS. A post card is roughly 30 native views, so the
// window size is the multiplier that decides whether the app stays inside a
// sane memory budget. These tests pin the numbers so a later tweak cannot
// silently walk them back to the defaults that caused the regression.
//
// The exact values are 9/4/5 rather than the original 5/2/3: windowSize 5
// blanked rows on hard flings, so they were raised to cover momentum while
// staying far below the RN default of 21. The `toBeLessThan` bounds below are
// the part that must never regress, and they hold for the new numbers too.
describe("list virtualization tuning", () => {
  it("keeps the mounted window well below the RN default of 21", () => {
    expect(LIST_WINDOW_SIZE).toBe(9);
    expect(LIST_WINDOW_SIZE).toBeLessThan(21);
  });

  it("renders a small first batch so the first frame stays off the critical path", () => {
    expect(LIST_INITIAL_RENDER).toBe(4);
    expect(LIST_INITIAL_RENDER).toBeLessThan(10);
  });

  it("spreads mount work across frames via a small per-batch limit", () => {
    expect(LIST_RENDER_BATCH).toBe(5);
    expect(LIST_RENDER_BATCH).toBeLessThan(10);
  });

  it("exposes exactly the props VirtualizedList understands", () => {
    expect(Object.keys(LIST_VIRTUALIZATION_PROPS).toSorted()).toEqual([
      "initialNumToRender",
      "maxToRenderPerBatch",
      "updateCellsBatchingPeriod",
      "windowSize",
    ]);
  });

  it("mirrors its own constants in the spread props", () => {
    expect(LIST_VIRTUALIZATION_PROPS.initialNumToRender).toBe(
      LIST_INITIAL_RENDER
    );
    expect(LIST_VIRTUALIZATION_PROPS.maxToRenderPerBatch).toBe(
      LIST_RENDER_BATCH
    );
    expect(LIST_VIRTUALIZATION_PROPS.updateCellsBatchingPeriod).toBe(
      LIST_BATCH_UPDATE_MS
    );
    expect(LIST_VIRTUALIZATION_PROPS.windowSize).toBe(LIST_WINDOW_SIZE);
  });

  it("never sets removeClippedSubviews, which the thread rail depends on", () => {
    // The feed keeps removeClippedSubviews={false} because clipped subviews
    // detach the gesture-handled thread rail and break its drag. Bundling it
    // into the shared props would re-introduce that bug, so it must stay an
    // explicit per-list decision.
    expect(LIST_VIRTUALIZATION_PROPS).not.toHaveProperty(
      "removeClippedSubviews"
    );
  });

  it("never sets getItemLayout, which would break variable-height rows", () => {
    // Post cards vary in height with media, tag pills and thread rails, so a
    // fixed row estimate would drift the scrollbar and offset restoration.
    expect(LIST_VIRTUALIZATION_PROPS).not.toHaveProperty("getItemLayout");
  });
});
