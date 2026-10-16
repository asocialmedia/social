import { expect, test } from "bun:test";

import { readDiscoveryPage } from "@asm/protocols/discovery";

import { createBlueskyFeed } from "./bluesky-feed";

const page = { cursor: "next", items: [], partial: false };

test("React Native signals need no throwIfAborted method to read or cancel", async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, "throwIfAborted", {
    value: undefined,
  });
  let calls = 0;
  const read = () =>
    readDiscoveryPage({
      cursor: null,
      fetch: () => {
        calls += 1;
        return Promise.resolve(Response.json(page));
      },
      mode: "latest",
      signal: controller.signal,
    });
  expect(await read()).toEqual(page);
  controller.abort();
  await expect(read()).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});

test("failed pagination retains rendered data and refresh can recover an expired cursor", async () => {
  let calls = 0;
  const store = createBlueskyFeed("https://asm.example", "latest", () => {
    calls += 1;
    return Promise.resolve(
      calls === 2
        ? Response.json({ error: "expired" }, { status: 410 })
        : Response.json(page)
    );
  });
  await store.refresh();
  expect(store.snapshot().pages).toHaveLength(1);
  await store.fetchNext();
  expect(store.snapshot().pages).toHaveLength(2);
  expect(store.snapshot().error).toBeNull();
  await store.refresh();
  expect(store.snapshot().error).toBeNull();
  expect(store.snapshot().status).toBe("success");
});

test("a disposed request cannot repopulate external content", async () => {
  const pending = Promise.withResolvers<Response>();
  const store = createBlueskyFeed(
    "https://asm.example",
    "latest",
    () => pending.promise
  );
  const request = store.refresh();
  store.dispose();
  pending.resolve(Response.json(page));
  await request;
  expect(store.snapshot().pages).toEqual([]);
  expect(store.snapshot().status).toBe("loading");
});

test("simultaneous pagination attempts share the current request", async () => {
  const pending = Promise.withResolvers<Response>();
  let calls = 0;
  const store = createBlueskyFeed("https://asm.example", "latest", () => {
    calls += 1;
    return calls === 1 ? Promise.resolve(Response.json(page)) : pending.promise;
  });
  await store.refresh();
  const next = store.fetchNext();
  await store.fetchNext();
  expect(calls).toBe(2);
  pending.resolve(Response.json({ ...page, cursor: null }));
  await next;
  expect(store.snapshot().pages).toHaveLength(2);
});
