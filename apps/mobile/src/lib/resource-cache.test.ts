import { expect, test } from "bun:test";

import { ResourceCache } from "./resource-cache";

test("each viewer and tab retains its own result while slow requests finish", async () => {
  const cache = new ResourceCache<string[]>({ maxEntries: 4, staleMs: 1000 });
  const first = Promise.withResolvers<string[]>();
  let calls = 0;
  const one = cache.load("viewer:followers", () => {
    calls += 1;
    return first.promise;
  });
  const same = cache.load("viewer:followers", () => {
    calls += 1;
    return first.promise;
  });
  await cache.load("viewer:following", () => Promise.resolve(["following"]));
  await cache.load("other:followers", () => Promise.resolve(["other"]));
  first.resolve(["followers"]);
  await Promise.all([one, same]);
  expect(calls).toBe(1);
  expect(cache.read("viewer:followers").data).toEqual(["followers"]);
  expect(cache.read("viewer:following").data).toEqual(["following"]);
  expect(cache.read("other:followers").data).toEqual(["other"]);
  await cache.load("viewer:followers", () => {
    calls += 1;
    return Promise.resolve([]);
  });
  expect(calls).toBe(1);
});

test("a failed refresh preserves visible content and a retry can recover", async () => {
  const cache = new ResourceCache<string[]>({ maxEntries: 4, staleMs: 1000 });
  cache.setData("posts", ["saved"]);
  await cache.load(
    "posts",
    () => {
      throw new Error("offline");
    },
    true
  );
  expect(cache.read("posts")).toMatchObject({
    data: ["saved"],
    error: "offline",
    status: "success",
  });
  await cache.load("posts", () => Promise.resolve(["recovered"]), true);
  expect(cache.read("posts").data).toEqual(["recovered"]);
});

test("clearing a scope prevents its pending requests from restoring old data", async () => {
  const cache = new ResourceCache<string[]>({ maxEntries: 4, staleMs: 1000 });
  const deferred = Promise.withResolvers<string[]>();
  const pending = cache.load("old-viewer", () => deferred.promise);
  cache.clear();
  deferred.resolve(["old-data"]);
  await pending;
  expect(cache.read("old-viewer").data).toBeNull();
});
