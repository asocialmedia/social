import { describe, expect, mock, test } from "bun:test";

import { findMessageGestureRow } from "./message-gesture-target";

// These ancestry stubs let the hit-test contract run without a browser or layout.
function targetWithAncestors(bubble: Element | null, row: HTMLElement | null) {
  const closest = mock((selector: string) => {
    if (selector === "[data-message-bubble]") {
      return bubble;
    }
    return selector === "[data-message-id]" ? row : null;
  });
  return { closest, target: { closest } as unknown as Element };
}

const row = { dataset: { messageId: "message-1" } } as HTMLElement;

describe("message gesture hit targets", () => {
  test("mobile ignores row whitespace without continuing the row lookup", () => {
    const { target, closest } = targetWithAncestors(null, row);
    expect(findMessageGestureRow(target, true)).toBeNull();
    expect(closest).toHaveBeenCalledTimes(1);
    expect(closest).toHaveBeenCalledWith("[data-message-bubble]");
  });

  test("mobile accepts a bubble and nested text inside that bubble", () => {
    const { target: bubble } = targetWithAncestors(null, row);
    const { target } = targetWithAncestors(bubble, row);
    expect(findMessageGestureRow(target, true)).toBe(row);
  });

  test("mobile ignores avatars, sender labels, dates, and selection gutters", () => {
    for (const surface of ["avatar", "sender", "date", "selection-gutter"]) {
      const { target } = targetWithAncestors(null, row);
      expect(findMessageGestureRow(target, true), surface).toBeNull();
    }
  });

  test("desktop preserves row gestures with a single ancestry lookup", () => {
    const { target, closest } = targetWithAncestors(null, row);
    expect(findMessageGestureRow(target, false)).toBe(row);
    expect(closest).toHaveBeenCalledTimes(1);
    expect(closest).toHaveBeenCalledWith("[data-message-id]");
  });

  test("a bubble outside a message row is not a transcript hit", () => {
    const { target: bubble } = targetWithAncestors(null, null);
    const { target } = targetWithAncestors(bubble, null);
    expect(findMessageGestureRow(target, true)).toBeNull();
  });
});
