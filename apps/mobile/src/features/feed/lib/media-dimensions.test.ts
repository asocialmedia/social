import { describe, expect, test } from "bun:test";

import { MediaDimensionsCache, mediaDimensionsKey } from "./media-dimensions";

describe("stable media geometry on relaunch", () => {
  test("decoded landscape and portrait sizes survive a cold process", () => {
    const previous = new MediaDimensionsCache(() => 1000);
    previous.set("landscape", { height: 1080, width: 1920 });
    previous.set("portrait", { height: 1280, width: 720 });
    const resumed = new MediaDimensionsCache(() => 2000);
    resumed.restore(structuredClone(previous.snapshot()));
    expect(resumed.get("landscape")).toEqual({ height: 1080, width: 1920 });
    expect(resumed.get("portrait")).toEqual({ height: 1280, width: 720 });
  });
  test("hydration never replaces a live decode and malformed sizes cannot produce broken layouts", () => {
    const live = new MediaDimensionsCache(() => 2000);
    live.set("a", { height: 900, width: 1600 });
    live.restore({
      entries: {
        a: { data: { height: 100, width: 100 }, fetchedAt: 1000 },
        future: { data: { height: 100, width: 100 }, fetchedAt: 3000 },
        invalid: { data: { height: 100, width: 0 }, fetchedAt: 1000 },
        malformed: { data: "invalid", fetchedAt: 1000 },
      },
      version: 1,
    });
    expect(live.get("a")).toEqual({ height: 900, width: 1600 });
    expect(Object.keys(live.snapshot().entries)).toEqual(["a"]);
  });
  test("the cache is bounded, expires old dimensions and keeps API origins separate", () => {
    let now = 1000;
    const cache = new MediaDimensionsCache(() => now, 2);
    for (const id of ["a", "b", "c"]) {
      cache.set(id, { height: 200, width: 100 });
    }
    expect(cache.get("a")).toBeNull();
    expect(Object.keys(cache.snapshot().entries)).toEqual(["b", "c"]);
    expect(mediaDimensionsKey("https://social.test/", "a")).toBe(
      mediaDimensionsKey("https://social.test", "a")
    );
    expect(mediaDimensionsKey("https://staging.test", "a")).not.toBe(
      mediaDimensionsKey("https://social.test", "a")
    );
    now += 31 * 24 * 60 * 60 * 1000;
    expect(cache.get("b")).toBeNull();
  });
});
