import { describe, expect, test } from "bun:test";

import { bubblePosition, bubbleRoundingClasses } from "./message-bubble-shape";
import type { BubblePosition } from "./message-bubble-shape";

describe("bubblePosition", () => {
  test("maps the group flags to the four positions", () => {
    expect(bubblePosition(true, true)).toBe("solo");
    expect(bubblePosition(true, false)).toBe("top");
    expect(bubblePosition(false, false)).toBe("middle");
    expect(bubblePosition(false, true)).toBe("bottom");
  });
});

describe("bubbleRoundingClasses", () => {
  const positions: BubblePosition[] = ["solo", "top", "middle", "bottom"];

  test("every position keeps the full base radius", () => {
    for (const position of positions) {
      expect(bubbleRoundingClasses(position, true)).toContain("rounded-2xl");
      expect(bubbleRoundingClasses(position, false)).toContain("rounded-2xl");
    }
  });

  test("solo is fully rounded with a tail", () => {
    expect(bubbleRoundingClasses("solo", true)).toBe(
      "rounded-2xl rounded-br-sm"
    );
    expect(bubbleRoundingClasses("solo", false)).toBe(
      "rounded-2xl rounded-bl-sm"
    );
  });

  test("bottom tightens its top corner so it meets the bubble above, tail below", () => {
    expect(bubbleRoundingClasses("bottom", true)).toBe(
      "rounded-2xl rounded-tr-md rounded-br-sm"
    );
    expect(bubbleRoundingClasses("bottom", false)).toBe(
      "rounded-2xl rounded-tl-md rounded-bl-sm"
    );
  });

  test("a two-message run: first tightens its bottom corner, second its top with the tail below", () => {
    expect(bubbleRoundingClasses("top", true)).toBe(
      "rounded-2xl rounded-br-md"
    );
    expect(bubbleRoundingClasses("bottom", true)).toBe(
      "rounded-2xl rounded-tr-md rounded-br-sm"
    );
    expect(bubbleRoundingClasses("top", false)).toBe(
      "rounded-2xl rounded-bl-md"
    );
    expect(bubbleRoundingClasses("bottom", false)).toBe(
      "rounded-2xl rounded-tl-md rounded-bl-sm"
    );
  });

  test("own messages shape only the right edge", () => {
    expect(bubbleRoundingClasses("top", true)).toBe(
      "rounded-2xl rounded-br-md"
    );
    expect(bubbleRoundingClasses("middle", true)).toBe(
      "rounded-2xl rounded-tr-md rounded-br-md"
    );
    expect(bubbleRoundingClasses("bottom", true)).toBe(
      "rounded-2xl rounded-tr-md rounded-br-sm"
    );
    for (const position of positions) {
      const classes = bubbleRoundingClasses(position, true);
      expect(classes).not.toContain("tl-");
      expect(classes).not.toContain("bl-");
    }
  });

  test("received messages shape only the left edge", () => {
    expect(bubbleRoundingClasses("top", false)).toBe(
      "rounded-2xl rounded-bl-md"
    );
    expect(bubbleRoundingClasses("middle", false)).toBe(
      "rounded-2xl rounded-tl-md rounded-bl-md"
    );
    expect(bubbleRoundingClasses("bottom", false)).toBe(
      "rounded-2xl rounded-tl-md rounded-bl-sm"
    );
    for (const position of positions) {
      const classes = bubbleRoundingClasses(position, false);
      expect(classes).not.toContain("tr-");
      expect(classes).not.toContain("br-");
    }
  });

  test("only solo and bottom carry the tail", () => {
    for (const position of ["top", "middle"] as const) {
      expect(bubbleRoundingClasses(position, true)).not.toContain("-sm");
      expect(bubbleRoundingClasses(position, false)).not.toContain("-sm");
    }
  });
});
