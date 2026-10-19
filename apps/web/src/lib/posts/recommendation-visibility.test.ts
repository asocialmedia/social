import { expect, test } from "bun:test";

import { isRecommendationVisible } from "./recommendation-visibility";

function entry(height: number, visible: number, viewport = 800) {
  return {
    boundingClientRect: { height },
    intersectionRatio: visible / height,
    intersectionRect: { height: visible, width: 400 },
    isIntersecting: visible > 0,
    rootBounds: { height: viewport },
  } as IntersectionObserverEntry;
}
test("tall cards can record a real viewport exposure while small slivers do not count", () => {
  expect(isRecommendationVisible(entry(2000, 700))).toBe(true);
  expect(isRecommendationVisible(entry(2000, 100))).toBe(false);
  expect(isRecommendationVisible(entry(400, 200))).toBe(false);
  expect(isRecommendationVisible(entry(400, 300))).toBe(true);
  expect(isRecommendationVisible()).toBe(false);
});
