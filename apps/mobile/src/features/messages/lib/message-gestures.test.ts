import { describe, expect, test } from "bun:test";

import {
  applySelectionRange,
  invertedContentY,
  messageAtPoint,
  replyOffset,
  selectionRangeIds,
  selectionScrollVelocity,
  shouldReply,
} from "./message-gestures";

describe("native message gestures", () => {
  const messages = ["old", "middle", "new"].map((id) => ({ id }));
  test("hold-drag spans chronology in either direction and ignores missing anchors", () => {
    expect(selectionRangeIds(messages, "new", "old")).toEqual([
      "old",
      "middle",
      "new",
    ]);
    expect(selectionRangeIds(messages, "old", "new")).toEqual([
      "old",
      "middle",
      "new",
    ]);
    expect(selectionRangeIds(messages, "missing", "new")).toEqual([]);
  });
  test("reversing a range restores rows outside it from the initial snapshot", () => {
    const base = new Set(["old"]);
    expect([...applySelectionRange(base, ["middle", "new"], "add")]).toEqual([
      "old",
      "middle",
      "new",
    ]);
    expect([...applySelectionRange(base, ["middle"], "add")]).toEqual([
      "old",
      "middle",
    ]);
    expect([...base]).toEqual(["old"]);
  });
  test("holding a selected row removes the range without affecting other selections", () => {
    expect([
      ...applySelectionRange(
        new Set(["old", "middle", "new", "other"]),
        ["middle", "new"],
        "remove"
      ),
    ]).toEqual(["old", "other"]);
  });
  test("inverted hit testing follows variable-height rows, scrolling and keyboard resize", () => {
    const frames = { new: { height: 60, y: 8 }, old: { height: 300, y: 100 } };
    expect(messageAtPoint(frames, invertedContentY(900, 100, 860, 0))).toBe(
      "new"
    );
    expect(messageAtPoint(frames, invertedContentY(500, 100, 560, 100))).toBe(
      "old"
    );
    expect(messageAtPoint(frames, 80)).toBeNull();
    expect(messageAtPoint(frames, 400)).toBeNull();
  });
  test("edge scrolling travels into older history at the top and newest at the bottom", () => {
    expect(selectionScrollVelocity(100, 100, 600)).toBe(360);
    expect(selectionScrollVelocity(700, 100, 600)).toBe(-360);
    expect(selectionScrollVelocity(400, 100, 600)).toBe(0);
    expect(selectionScrollVelocity(-900, 100, 600)).toBe(360);
    expect(selectionScrollVelocity(100, 100, 0)).toBe(0);
  });
  test("reply requires a deliberate right swipe or a sufficiently long flick", () => {
    expect(shouldReply(56, 0)).toBe(true);
    expect(shouldReply(25, 1000)).toBe(true);
    expect(shouldReply(20, 2000)).toBe(false);
    expect(shouldReply(40, 100)).toBe(false);
    expect(shouldReply(-100, -2000)).toBe(false);
    expect(replyOffset(-50)).toBe(0);
    expect(replyOffset(56)).toBe(56);
    expect(replyOffset(1000)).toBeGreaterThan(72);
    expect(replyOffset(1000)).toBeLessThan(88);
  });
});
