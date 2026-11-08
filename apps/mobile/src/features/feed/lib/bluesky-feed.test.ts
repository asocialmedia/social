import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { readDiscoveryPage } from "@asm/protocols/discovery";

import { createBlueskyFeed } from "./bluesky-feed";

const page = { cursor: "next", items: [external("baseline")], partial: false };

test("repeated Bluesky cursors stop the skeleton and retain posts until manual retry", async () => {
  let calls = 0;
  let recover = false;
  const store = createBlueskyFeed("https://asm.test", "latest", () => {
    calls += 1;
    return Promise.resolve(
      Response.json(
        recover
          ? { ...page, cursor: null, items: [external("recovered")] }
          : page
      )
    );
  });
  await store.refresh();
  const [first] = store.snapshot().pages;
  await store.fetchNext();
  expect(store.snapshot().status).toBe("error");
  expect(store.snapshot().loadingMore).toBe(false);
  expect(store.snapshot().pages).toEqual([first]);
  const stoppedAt = calls;
  await store.fetchNext();
  expect(calls).toBe(stoppedAt);
  recover = true;
  await store.retry();
  expect(store.snapshot().status).toBe("success");
  expect(store.snapshot().pages).toHaveLength(2);
  expect(store.snapshot().pages[0]).toBe(first);
  store.dispose();
});

test("a stalled continuation has a whole-read deadline and remains retryable", async () => {
  let calls = 0;
  const pending = Promise.withResolvers<Response>();
  const store = createBlueskyFeed(
    "https://asm.test",
    "latest",
    () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(Response.json(page));
      }
      if (calls === 2) {
        return pending.promise;
      }
      return Promise.resolve(
        Response.json({ ...page, cursor: null, items: [external("retry")] })
      );
    },
    false,
    { timeoutMs: 20 }
  );
  await store.refresh();
  const [first] = store.snapshot().pages;
  await store.fetchNext();
  expect(store.snapshot().status).toBe("error");
  expect(store.snapshot().loadingMore).toBe(false);
  expect(store.snapshot().pages).toEqual([first]);
  pending.resolve(Response.json({ ...page, items: [external("too-late")] }));
  await Promise.resolve();
  expect(store.snapshot().pages).toEqual([first]);
  await store.retry();
  expect(store.snapshot().status).toBe("success");
  expect(store.snapshot().pages.at(-1)?.items[0]?.id).toBe(
    external("retry").id
  );
  store.dispose();
});

test("an empty initial Bluesky page advances its cursor without requiring a scroll", async () => {
  const urls: string[] = [];
  const store = createBlueskyFeed("https://asm.test", "latest", (url) => {
    urls.push(url);
    return Promise.resolve(
      Response.json(
        urls.length === 1
          ? { ...page, cursor: "filtered-page", items: [] }
          : { ...page, cursor: null, items: [external("visible")] }
      )
    );
  });
  await store.refresh();
  expect(urls).toHaveLength(2);
  expect(urls[1]).toContain("cursor=filtered-page");
  expect(store.snapshot().status).toBe("success");
  expect(store.snapshot().pages[0]?.items[0]?.id).toBe(external("visible").id);
  store.dispose();
});

test("empty cursor chains stay bounded when Bluesky has nothing visible", async () => {
  let calls = 0;
  const store = createBlueskyFeed("https://asm.test", "latest", () => {
    calls += 1;
    return Promise.resolve(
      Response.json({ ...page, cursor: `empty-${calls}`, items: [] })
    );
  });
  await store.refresh();
  expect(calls).toBe(3);
  expect(store.snapshot().status).toBe("error");
  expect(store.snapshot().loadingMore).toBe(false);
  expect(store.snapshot().pages).toEqual([]);
  store.dispose();
});

function external(id: string): ExternalPost {
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

test("pausing retains loaded pages so returning paints without a refetch", async () => {
  let reads = 0;
  const store = createBlueskyFeed("https://asm.test", "latest", () => {
    reads += 1;
    return Promise.resolve(
      Response.json({ ...page, items: [external("kept")] })
    );
  });
  await store.refresh();
  expect(store.snapshot().pages).toHaveLength(1);
  store.pause();
  store.activate();
  expect(store.snapshot().pages).toHaveLength(1);
  expect(store.snapshot().pages[0]?.items.map((item) => item.id)).toEqual([
    external("kept").id,
  ]);
  expect(store.snapshot().status).toBe("success");
  expect(reads).toBe(1);
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
  expect(store.snapshot().pages[0]?.items).toEqual(page.items);
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
        : Response.json({ ...page, items: [external(`page-${calls}`)] })
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

test("retry re-reads the failed page and keeps the loaded pages", async () => {
  const urls: string[] = [];
  const store = createBlueskyFeed("https://asm.example", "latest", (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return Promise.resolve(
        Response.json({ ...page, items: [external("first")] })
      );
    }
    if (urls.length === 2) {
      return Promise.resolve(Response.json({ error: "bad" }, { status: 400 }));
    }
    return Promise.resolve(
      Response.json({
        cursor: null,
        items: [external("second")],
        partial: false,
      })
    );
  });
  await store.refresh();
  await store.fetchNext();
  expect(store.snapshot().status).toBe("error");
  expect(store.snapshot().pages).toHaveLength(1);
  await store.retry();
  expect(store.snapshot().status).toBe("success");
  expect(store.snapshot().error).toBeNull();
  expect(store.snapshot().pages).toHaveLength(2);
  expect(urls.at(-1)).toContain("cursor=next");
  store.dispose();
});

for (const initial of [true, false]) {
  test(`retry advances beyond three empty windows (initial: ${initial})`, async () => {
    const cursors: (string | null)[] = [];
    const store = createBlueskyFeed("https://asm.test", "latest", (url) => {
      const cursor = new URL(url).searchParams.get("cursor");
      cursors.push(cursor);
      if (!initial && cursor === null) {
        return Promise.resolve(Response.json(page));
      }
      const index = cursor?.startsWith("empty-") ? Number(cursor.slice(6)) : 0;
      return Promise.resolve(
        Response.json(
          index < 3
            ? { ...page, cursor: `empty-${index + 1}`, items: [] }
            : { ...page, cursor: null, items: [external("after-empty")] }
        )
      );
    });
    await store.refresh();
    if (!initial) {
      await store.fetchNext();
    }
    expect(store.snapshot().status).toBe("error");
    const [loaded] = store.snapshot().pages;
    await store.retry();
    expect(cursors.at(-1)).toBe("empty-3");
    expect(store.snapshot().status).toBe("success");
    expect(store.snapshot().pages.at(-1)?.items[0]?.id).toBe(
      external("after-empty").id
    );
    if (!initial) {
      expect(store.snapshot().pages[0]).toBe(loaded);
    }
    store.dispose();
  });
}
