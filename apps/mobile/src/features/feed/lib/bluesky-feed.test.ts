import { expect, test } from "bun:test";

import { readDiscoveryPage } from "@asm/protocols/discovery";

import { createBlueskyFeed } from "./bluesky-feed";

const page = { cursor: "next", items: [], partial: false };

function external(id: string) {
  return {
    author: {
      displayName: "Example",
      handle: "example.test",
      id: "did:web:example.test",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/example.test",
    },
    createdAt: "2026-10-17T10:00:00.000Z",
    id: `at://did:web:example.test/app.bsky.feed.post/${id}`,
    indexedAt: "2026-10-17T10:00:01.000Z",
    labels: [],
    languages: [],
    media: [],
    revision: "cid",
    segments: [{ text: id }],
    source: "bluesky",
    text: id,
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: `https://bsky.app/profile/example.test/post/${id}`,
  };
}

test("event reads buffer new rows until acceptance without replacing loaded pages or continuation cursors", async () => {
  const old = external("old");
  const older = external("older");
  const fresh = external("new");
  const responses = [
    { ...page, items: [old] },
    { ...page, cursor: "tail", items: [older] },
    { ...page, cursor: "new-session", items: [fresh, old] },
  ];
  const store = createBlueskyFeed("https://asm.test", "latest", () =>
    Promise.resolve(Response.json(responses.shift()))
  );
  await store.refresh();
  await store.fetchNext();
  const [, tail] = store.snapshot().pages;
  await store.probe();
  expect(store.snapshot().pages[0]?.items.map((item) => item.id)).toEqual([
    old.id,
  ]);
  expect(store.snapshot().newItems.map((item) => item.id)).toEqual([fresh.id]);
  store.acceptNew();
  expect(store.snapshot().newItems).toEqual([]);
  expect(store.snapshot().pages[0]?.items.map((item) => item.id)).toEqual([
    fresh.id,
    old.id,
  ]);
  expect(store.snapshot().pages[0]?.cursor).toBe("next");
  expect(store.snapshot().pages[1]).toBe(tail);
  expect(store.snapshot().pages[1]?.cursor).toBe("tail");
  store.dispose();
});

test("pausing cancels a pending head read before it can repopulate a tab", async () => {
  const pending = Promise.withResolvers<Response>();
  let reads = 0;
  const store = createBlueskyFeed("https://asm.test", "latest", () => {
    reads += 1;
    return reads === 1 ? Promise.resolve(Response.json(page)) : pending.promise;
  });
  await store.refresh();
  const head = store.probe();
  store.pause();
  pending.resolve(Response.json({ ...page, items: [external("new")] }));
  await head;
  expect(store.snapshot().pages[0]?.items).toEqual([]);
  store.dispose();
});

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

test("Following uses its authenticated endpoint for initial, continuation, and event head reads", async () => {
  const urls: string[] = [];
  const store = createBlueskyFeed(
    "https://asm.test",
    "latest",
    (url) => {
      urls.push(url);
      return Promise.resolve(
        Response.json({
          cursor: "tail",
          items: [external(String(urls.length))],
          partial: false,
        })
      );
    },
    true
  );
  await store.refresh();
  await store.fetchNext();
  await store.probe();
  expect(urls).toHaveLength(3);
  expect(urls.every((url) => url.includes("/bluesky/following?"))).toBe(true);
  store.dispose();
});
