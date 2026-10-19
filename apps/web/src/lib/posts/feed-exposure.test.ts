import { afterAll, expect, test } from "bun:test";

import { otherFeedExposures, rememberFeedExposure } from "./feed-exposure";

const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const values = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});
afterAll(() => {
  if (original) {
    Object.defineProperty(globalThis, "sessionStorage", original);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("Home and Gusts suppress opposite-feed exposures without sharing another viewer's history", () => {
  rememberFeedExposure("viewer", "home", "video-one", 1000);
  rememberFeedExposure("other-viewer", "home", "private-view", 1000);
  expect([...otherFeedExposures("viewer", "gusts", 2000)]).toEqual([
    "video-one",
  ]);
  expect(otherFeedExposures("viewer", "home", 2000).size).toBe(0);
  expect(otherFeedExposures("viewer", "gusts", 8_000_000).size).toBe(0);
});

test("exposure history is bounded and malformed storage cannot break a feed", () => {
  for (let index = 0; index < 650; index += 1) {
    rememberFeedExposure("bounded", "home", String(index), 1000 + index);
  }
  expect(otherFeedExposures("bounded", "gusts", 2000).size).toBe(600);
  values.set("asm:feed-exposure:broken", "invalid");
  expect(otherFeedExposures("broken", "gusts").size).toBe(0);
});

test("Explore and Home exclude the other surface's seen posts while keeping the viewer isolated", () => {
  rememberFeedExposure("explorer", "home", "home-post", 1000);
  rememberFeedExposure("explorer", "explore", "novel-post", 1100);
  expect([...otherFeedExposures("explorer", "explore", 2000)]).toEqual([
    "home-post",
  ]);
  expect([...otherFeedExposures("explorer", "home", 2000)]).toEqual([
    "novel-post",
  ]);
  expect(otherFeedExposures("other-explorer", "explore", 2000).size).toBe(0);
});
