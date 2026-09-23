import { describe, expect, test } from "bun:test";

import {
  formatTimeDivider,
  getMessageGroupMeta,
  GROUP_WINDOW_MS,
  TIME_DIVIDER_MS,
} from "./message-grouping";

const T0 = new Date("2026-01-01T12:00:00.000Z").getTime();

function at(offsetMs: number, senderId = "alice") {
  return { createdAt: new Date(T0 + offsetMs), senderId };
}

describe("getMessageGroupMeta", () => {
  test("groups consecutive messages from the same sender within the window", () => {
    const messages = [at(0), at(60_000), at(120_000)];
    expect(getMessageGroupMeta(messages, 0)).toEqual({
      isFirstInGroup: true,
      isLastInGroup: false,
      showTimeDivider: true,
    });
    expect(getMessageGroupMeta(messages, 1)).toEqual({
      isFirstInGroup: false,
      isLastInGroup: false,
      showTimeDivider: false,
    });
    expect(getMessageGroupMeta(messages, 2)).toEqual({
      isFirstInGroup: false,
      isLastInGroup: true,
      showTimeDivider: false,
    });
  });

  test("breaks the group when the sender changes", () => {
    const messages = [at(0, "alice"), at(60_000, "bob")];
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(true);
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(true);
  });

  test("breaks the group just past the window", () => {
    const messages = [at(0), at(GROUP_WINDOW_MS + 1)];
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(true);
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(true);
  });

  test("keeps the group exactly at the window boundary", () => {
    const messages = [at(0), at(GROUP_WINDOW_MS)];
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(false);
  });

  test("shows a divider only past the divider window", () => {
    const messages = [at(0), at(TIME_DIVIDER_MS)];
    expect(getMessageGroupMeta(messages, 1).showTimeDivider).toBe(false);
    const far = [at(0), at(TIME_DIVIDER_MS + 1)];
    expect(getMessageGroupMeta(far, 1).showTimeDivider).toBe(true);
  });

  test("always shows a divider before the first message", () => {
    expect(getMessageGroupMeta([at(0)], 0).showTimeDivider).toBe(true);
  });

  test("does not continue a group across a negative gap (clock skew)", () => {
    const messages = [at(60_000), at(0)];
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(true);
  });

  test("fails safe on an unparseable timestamp", () => {
    const messages = [
      { createdAt: "not a date", senderId: "alice" },
      { createdAt: "also bad", senderId: "alice" },
    ];
    const first = getMessageGroupMeta(messages, 0);
    expect(first.isFirstInGroup).toBe(true);
    expect(first.isLastInGroup).toBe(true);
    expect(first.showTimeDivider).toBe(true);
    // No bogus divider from a NaN gap on the second row.
    expect(getMessageGroupMeta(messages, 1).showTimeDivider).toBe(false);
  });

  test("accepts JSON date strings from a fetched page", () => {
    const messages = [
      { createdAt: new Date(T0).toISOString(), senderId: "alice" },
      { createdAt: new Date(T0 + 60_000).toISOString(), senderId: "alice" },
    ];
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(false);
    expect(getMessageGroupMeta(messages, 1).showTimeDivider).toBe(false);
  });

  test("returns a self-contained row for an out-of-range index", () => {
    expect(getMessageGroupMeta([], 3)).toEqual({
      isFirstInGroup: true,
      isLastInGroup: true,
      showTimeDivider: false,
    });
  });
});

describe("formatTimeDivider", () => {
  const now = new Date("2026-06-15T15:00:00.000Z");

  test("shows a bare time for today", () => {
    const today = new Date("2026-06-15T09:30:00.000Z");
    expect(formatTimeDivider(today, now)).toContain("AM");
    expect(formatTimeDivider(today, now)).not.toContain("Yesterday");
  });

  test("prefixes Yesterday for the previous day", () => {
    const yesterday = new Date("2026-06-14T09:30:00.000Z");
    expect(formatTimeDivider(yesterday, now)).toStartWith("Yesterday ");
  });

  test("shows the month and day for an earlier date this year", () => {
    const earlier = new Date("2026-03-02T09:30:00.000Z");
    expect(formatTimeDivider(earlier, now)).toStartWith("Mar 2");
  });

  test("includes the year for an earlier year", () => {
    const lastYear = new Date("2025-12-31T09:30:00.000Z");
    expect(formatTimeDivider(lastYear, now)).toContain("2025");
  });

  test("returns null for a missing or unparseable timestamp", () => {
    expect(formatTimeDivider(null, now)).toBeNull();
    expect(formatTimeDivider(undefined, now)).toBeNull();
    expect(formatTimeDivider("nope", now)).toBeNull();
  });

  test("accepts a JSON ISO string", () => {
    expect(formatTimeDivider("2026-06-15T09:30:00.000Z", now)).toContain("AM");
  });
});
