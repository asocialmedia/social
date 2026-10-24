import { afterAll, expect, mock, test } from "bun:test";

import { recordFeedRenderTiming } from "./feed-render-timing";

const original = Object.getOwnPropertyDescriptor(globalThis, "performance");
const measure = mock(
  (_name: string, _options: PerformanceMeasureOptions) => {}
);
const resources = [
  {
    name: "http://localhost/api/protocols/bluesky/discover?mode=personalized&content=all",
    responseEnd: 30,
    startTime: 10,
  },
  {
    name: "http://localhost/api/protocols/bluesky/discover?mode=personalized&content=video",
    responseEnd: 40,
    startTime: 12,
  },
  {
    name: "http://localhost/api/posts/for-you?surface=explore",
    responseEnd: 45,
    startTime: 15,
  },
];
Object.defineProperty(globalThis, "performance", {
  configurable: true,
  value: { getEntriesByType: () => resources, measure, now: () => 50 },
});
afterAll(() => {
  if (original) {
    Object.defineProperty(globalThis, "performance", original);
  } else {
    Reflect.deleteProperty(globalThis, "performance");
  }
});

test("render timing uses the visible feed's response rather than a concurrent sidebar or other surface", () => {
  recordFeedRenderTiming("home", "for-you");
  expect(measure.mock.calls[0]).toEqual([
    "asm.feed.network-to-visible",
    { detail: { feed: "for-you", surface: "home" }, end: 50, start: 10 },
  ]);
  expect(measure.mock.calls[1]?.[1].start).toBe(30);
  recordFeedRenderTiming("home", "for-you");
  expect(measure).toHaveBeenCalledTimes(2);
  recordFeedRenderTiming("gusts", "personalized");
  expect(measure.mock.calls[2]?.[1].start).toBe(12);
  recordFeedRenderTiming("explore", "personalized");
  expect(measure.mock.calls[4]?.[1].start).toBe(15);
});
