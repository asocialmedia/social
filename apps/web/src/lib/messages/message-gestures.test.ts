import { describe, expect, test } from "bun:test";

import {
  applySelectionRange,
  clampToViewport,
  dragSelectionMode,
  exceededSlop,
  GESTURE_SLOP_PX,
  placeOptionsPane,
  selectionRange,
} from "./message-gestures";

describe("exceededSlop", () => {
  test("absorbs jitter below the threshold", () => {
    expect(
      exceededSlop({ x: 10, y: 10 }, { x: 10 + GESTURE_SLOP_PX, y: 10 })
    ).toBe(false);
  });

  test("fires past the threshold in any direction", () => {
    expect(
      exceededSlop({ x: 10, y: 10 }, { x: 10 + GESTURE_SLOP_PX + 1, y: 10 })
    ).toBe(true);
    expect(exceededSlop({ x: 10, y: 10 }, { x: 10, y: 10 - 20 })).toBe(true);
  });

  test("uses euclidean distance, not per-axis", () => {
    // 6px on each axis is 8.49px diagonal, past the 8px radius.
    expect(exceededSlop({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true);
  });
});

describe("selectionRange", () => {
  test("is inclusive and order-independent", () => {
    expect(selectionRange(2, 5)).toEqual([2, 3, 4, 5]);
    expect(selectionRange(5, 2)).toEqual([2, 3, 4, 5]);
    expect(selectionRange(3, 3)).toEqual([3]);
  });
});

describe("applySelectionRange", () => {
  test("adds the range on top of the drag-start snapshot", () => {
    const next = applySelectionRange(new Set(["a"]), ["b", "c"], "add");
    expect([...next].toSorted()).toEqual(["a", "b", "c"]);
  });

  test("removes the range when the drag started on a selected row", () => {
    const next = applySelectionRange(
      new Set(["a", "b", "c"]),
      ["b", "c"],
      "remove"
    );
    expect([...next]).toEqual(["a"]);
  });

  test("rebuilding from the base restores rows left behind by the drag", () => {
    // First move selected a..c, second move only c: b reverts to the base.
    const base = new Set(["a"]);
    const first = applySelectionRange(base, ["b", "c"], "add");
    const second = applySelectionRange(base, ["c"], "add");
    expect([...first].toSorted()).toEqual(["a", "b", "c"]);
    expect([...second].toSorted()).toEqual(["a", "c"]);
  });
});

describe("dragSelectionMode", () => {
  test("clears when the drag starts on a selected row", () => {
    expect(dragSelectionMode(new Set(["m1"]), "m1")).toBe("remove");
  });

  test("selects when the drag starts on an unselected row", () => {
    expect(dragSelectionMode(new Set(["m1"]), "m2")).toBe("add");
  });
});

describe("placeOptionsPane", () => {
  const viewport = { height: 800, width: 1200 };
  const size = { height: 300, width: 224 };

  test("peer (receiver) pane opens to the right of the bubble when it fits", () => {
    const point = placeOptionsPane({
      preferEnd: false,
      rect: { bottom: 120, left: 100, right: 300, top: 100 },
      size,
      viewport,
    });
    expect(point).toEqual({ x: 308, y: 100 });
  });

  test("own (sender) pane opens to the left of the bubble when it fits", () => {
    const point = placeOptionsPane({
      preferEnd: true,
      rect: { bottom: 120, left: 900, right: 1100, top: 100 },
      size,
      viewport,
    });
    expect(point).toEqual({ x: 900 - 8 - 224, y: 100 });
  });

  test("flips to the other side when the preferred side has no room", () => {
    // Peer bubble near the right edge: right side would overshoot, so flip left.
    const point = placeOptionsPane({
      preferEnd: false,
      rect: { bottom: 120, left: 900, right: 1100, top: 100 },
      size,
      viewport,
    });
    expect(point).toEqual({ x: 900 - 8 - 224, y: 100 });
  });

  test("clamps when neither side fits (narrow phone)", () => {
    const phone = { height: 700, width: 360 };
    const point = placeOptionsPane({
      preferEnd: false,
      // A bubble spanning most of the width leaves no room either side.
      rect: { bottom: 120, left: 16, right: 344, top: 100 },
      size,
      viewport: phone,
    });
    // Never overshoots: left >= margin, right <= width - margin.
    expect(point.x).toBeGreaterThanOrEqual(8);
    expect(point.x + size.width).toBeLessThanOrEqual(phone.width - 8);
  });

  test("clamps vertically so a low message cannot push the pane off-screen", () => {
    const point = placeOptionsPane({
      preferEnd: false,
      rect: { bottom: 790, left: 100, right: 300, top: 770 },
      size,
      viewport,
    });
    expect(point.y).toBe(viewport.height - size.height - 8);
  });

  test("an unmeasured bubble rect still yields an on-screen point", () => {
    // Anchor rect of all zeroes (element not laid out yet).
    const point = placeOptionsPane({
      preferEnd: true,
      rect: { bottom: 0, left: 0, right: 0, top: 0 },
      size,
      viewport,
    });
    expect(point.x).toBeGreaterThanOrEqual(8);
    expect(point.y).toBeGreaterThanOrEqual(8);
  });
});

describe("clampToViewport", () => {
  const viewport = { height: 800, width: 1000 };
  const size = { height: 200, width: 240 };

  test("leaves an in-bounds point untouched", () => {
    expect(clampToViewport({ x: 100, y: 100 }, size, viewport)).toEqual({
      x: 100,
      y: 100,
    });
  });

  test("clamps a point past the right and bottom edges", () => {
    expect(clampToViewport({ x: 990, y: 790 }, size, viewport)).toEqual({
      x: 1000 - 240 - 8,
      y: 800 - 200 - 8,
    });
  });

  test("clamps a negative point to the margin", () => {
    expect(clampToViewport({ x: -50, y: -50 }, size, viewport)).toEqual({
      x: 8,
      y: 8,
    });
  });

  test("never returns a negative max when the panel is larger than the viewport", () => {
    const huge = { height: 900, width: 1100 };
    expect(clampToViewport({ x: 500, y: 500 }, huge, viewport)).toEqual({
      x: 8,
      y: 8,
    });
  });
});
