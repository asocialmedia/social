import { expect, test } from "bun:test";

import { opensGustProfile } from "./profile-swipe";

const swipe = (translationX: number, translationY = 0, velocityX = 0) =>
  opensGustProfile({
    translationX,
    translationY,
    velocityX,
    viewportWidth: 400,
  });

test("a deliberate left drag or short left flick opens the Gust author", () => {
  expect(swipe(-80)).toBe(true);
  expect(swipe(-120, 40)).toBe(true);
  expect(swipe(-32, 0, -700)).toBe(true);
  expect(swipe(-79, 0, -699)).toBe(false);
});

test("right swipes, taps, and tiny fast movements do not navigate", () => {
  expect(swipe(120, 0, 900)).toBe(false);
  expect(swipe(0)).toBe(false);
  expect(swipe(-31, 0, -2000)).toBe(false);
});

test("vertical and diagonal paging stays in the Gusts feed", () => {
  expect(swipe(0, -300)).toBe(false);
  expect(swipe(-100, -200, -900)).toBe(false);
  expect(swipe(-100, 46, -900)).toBe(false);
  expect(swipe(-100, -46, -900)).toBe(false);
});

test("drag distance adapts to the viewport with a minimum intentional travel", () => {
  expect(
    opensGustProfile({
      translationX: -63,
      translationY: 0,
      velocityX: 0,
      viewportWidth: 240,
    })
  ).toBe(false);
  expect(
    opensGustProfile({
      translationX: -159,
      translationY: 0,
      velocityX: 0,
      viewportWidth: 800,
    })
  ).toBe(false);
  expect(
    opensGustProfile({
      translationX: -160,
      translationY: 0,
      velocityX: 0,
      viewportWidth: 800,
    })
  ).toBe(true);
});
