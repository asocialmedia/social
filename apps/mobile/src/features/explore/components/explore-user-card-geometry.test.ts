import { describe, expect, test } from "bun:test";

import {
  AVATAR_CORNER,
  AVATAR_OVERLAP,
  AVATAR_RING_ALIGN_SELF,
  AVATAR_SIZE,
  RING_BORDER,
  RING_RADIUS,
} from "./explore-user-card-geometry";

// Every expectation here mirrors an explicit literal in web's
// explore-user-card.tsx, so a change on one side has to be made deliberately on
// the other.
describe("explore user card avatar ring", () => {
  test("matches web's rounded-2xl ring-4 on a size-56 avatar", () => {
    expect(AVATAR_SIZE).toBe(56);
    expect(AVATAR_CORNER).toBe(16);
    expect(RING_BORDER).toBe(4);
    expect(RING_RADIUS).toBe(20);
  });

  test("keeps the ring rounded so the image nests instead of clipping", () => {
    // The border is drawn inside the wrapper, so the wrapper's radius has to
    // exceed the image's by the border width. Anything less paints the ring's
    // inner edge inside the image's own curve and clips the corners.
    expect(RING_RADIUS).toBe(AVATAR_CORNER + RING_BORDER);
  });

  test("the ring wrapper is square, not stretched by its column parent", () => {
    // Regression: the card body is a column, and React Native stretches
    // children across the cross axis by default. Without this the ring renders
    // as a border around a full-width bar, which only becomes obvious on
    // highlighted cards where the ring contrasts against the card.
    expect(AVATAR_RING_ALIGN_SELF).toBe("flex-start");
  });

  test("straddles the banner the way web's -mt-9 does", () => {
    expect(AVATAR_OVERLAP).toBe(-36);
    // The 56px image plus 4px of ring on each side is 64px tall, so -36 puts
    // 36px of it over the banner and leaves 28px inside the card body. Web
    // gets the same split from a 64px ring lifted by -36.
    const ringHeight = AVATAR_SIZE + RING_BORDER * 2;
    const overBanner = -AVATAR_OVERLAP;
    expect(ringHeight).toBe(64);
    expect(overBanner).toBe(36);
    expect(ringHeight - overBanner).toBe(28);
  });
});
