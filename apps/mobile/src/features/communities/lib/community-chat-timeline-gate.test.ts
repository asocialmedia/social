import { describe, expect, it } from "bun:test";

import { shouldSnapTimelineToLatest } from "./community-chat-timeline-gate";

describe("shouldSnapTimelineToLatest", () => {
  it("snaps when settled at the live tail", () => {
    expect(
      shouldSnapTimelineToLatest({
        dragging: false,
        lastOffsetY: 0,
        lastScrollAtMs: 1000,
        nowMs: 2000,
      })
    ).toBe(true);
  });

  it("holds the snap while the finger is down", () => {
    expect(
      shouldSnapTimelineToLatest({
        dragging: true,
        lastOffsetY: 0,
        lastScrollAtMs: 1000,
        nowMs: 2000,
      })
    ).toBe(false);
  });

  it("holds the snap when the reader scrolled up", () => {
    expect(
      shouldSnapTimelineToLatest({
        dragging: false,
        lastOffsetY: 200,
        lastScrollAtMs: 1000,
        nowMs: 5000,
      })
    ).toBe(false);
  });

  it("holds the snap right after a scroll event in case the offset is stale", () => {
    expect(
      shouldSnapTimelineToLatest({
        dragging: false,
        lastOffsetY: 0,
        lastScrollAtMs: 1900,
        nowMs: 2000,
      })
    ).toBe(false);
  });
});
