import { describe, expect, test } from "bun:test";

import { EngagementStore } from "./engagement-store";

// The store reaches the two read endpoints through feed-api's global fetch.
// Every test injects a fake and asserts on the requests that actually went
// out, because "did this fire a request" is the behaviour under test.
const API = "https://api.test";

function fakeFetch(responder: (url: string) => Response) {
  const calls: string[] = [];
  const baseFetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(responder(String(input)));
  }) as unknown as typeof fetch;
  return { baseFetch, calls };
}

const voteBody = (aura: number, userVote: number) =>
  Response.json({ aura, userVote });
const bookmarkBody = (saved: boolean) =>
  Response.json({ isBookmarkedByUser: saved });

const neutral = { aura: 0, isBookmarkedByUser: false, userVote: 0 };

describe("EngagementStore", () => {
  test("read returns the payload value with no request", () => {
    const store = new EngagementStore();
    const { calls } = fakeFetch(() => voteBody(1, 1));
    store.seed("post-1", { aura: 12, isBookmarkedByUser: true, userVote: 1 });
    expect(store.read("post-1", neutral)).toEqual({
      aura: 12,
      isBookmarkedByUser: true,
      userVote: 1,
    });
    expect(store.size).toBe(1);
    // Seeding is pure bookkeeping: it never touches the network.
    expect(calls).toHaveLength(0);
  });

  test("an unseeded key falls back to the caller's value", () => {
    const store = new EngagementStore();
    expect(
      store.read("missing", { aura: 5, isBookmarkedByUser: true, userVote: -1 })
    ).toEqual({ aura: 5, isBookmarkedByUser: true, userVote: -1 });
  });

  test("a seeded entry counts as fresh, so refresh fires nothing", async () => {
    const store = new EngagementStore({ now: () => 1000, staleMs: 5000 });
    const { baseFetch, calls } = fakeFetch(() => voteBody(99, 1));
    store.seed("post-1", { aura: 12, userVote: 1 });
    await store.refresh("post-1", { apiBase: API, baseFetch });
    // The regression that caused the flood: a freshly seeded post must not
    // immediately be re-read from the server.
    expect(calls).toHaveLength(0);
  });

  test("refresh re-reads once the entry goes stale", async () => {
    let now = 1000;
    const store = new EngagementStore({ now: () => now, staleMs: 5000 });
    const { baseFetch, calls } = fakeFetch((url) =>
      url.endsWith("/bookmark") ? bookmarkBody(true) : voteBody(30, 1)
    );
    store.seed("post-1", { aura: 12, userVote: 1 });
    now = 7001;
    const result = await store.refresh("post-1", { apiBase: API, baseFetch });
    expect(calls).toHaveLength(2);
    expect(result).toEqual({ aura: 30, isBookmarkedByUser: true, userVote: 1 });
  });

  test("concurrent refreshes for one post share a single request", async () => {
    let now = 1000;
    const store = new EngagementStore({ now: () => now, staleMs: 1 });
    const { baseFetch, calls } = fakeFetch((url) =>
      url.endsWith("/bookmark") ? bookmarkBody(false) : voteBody(7, 0)
    );
    store.seed("post-1", { aura: 1, userVote: 0 });
    now = 5000;
    await Promise.all([
      store.refresh("post-1", { apiBase: API, baseFetch }),
      store.refresh("post-1", { apiBase: API, baseFetch }),
      store.refresh("post-1", { apiBase: API, baseFetch }),
    ]);
    // One vote read and one bookmark read, not three of each: a feed card and
    // the detail screen for the same post must not race.
    expect(calls).toHaveLength(2);
  });
});

describe("EngagementStore field ownership and eviction", () => {
  test("a failed read keeps the seeded value", async () => {
    let now = 1000;
    const store = new EngagementStore({ now: () => now, staleMs: 1 });
    const { baseFetch } = fakeFetch(() => Response.json({}, { status: 500 }));
    store.seed("post-1", { aura: 12, isBookmarkedByUser: true, userVote: 1 });
    now = 9000;
    await store.refresh("post-1", { apiBase: API, baseFetch });
    expect(store.read("post-1", neutral)).toEqual({
      aura: 12,
      isBookmarkedByUser: true,
      userVote: 1,
    });
  });

  test("seeding one field leaves another component's field alone", () => {
    const store = new EngagementStore();
    // The vote cluster resolves aura and userVote...
    store.seed("post-1", { aura: 40, userVote: 1 });
    // ...and the bookmark toggle, mounting right after, only knows this.
    store.seed("post-1", { isBookmarkedByUser: true });
    // A blanket overwrite here would have reset the vote to 0/0 and made the
    // button flicker back to un-amplified.
    expect(store.read("post-1", neutral)).toEqual({
      aura: 40,
      isBookmarkedByUser: true,
      userVote: 1,
    });
  });

  test("a mutation write reaches every surface at once", () => {
    const store = new EngagementStore();
    store.seed("post-1", { aura: 10, userVote: 0 });
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.read("post-1", neutral).aura);
    });
    store.set("post-1", { aura: 11, userVote: 1 });
    unsubscribe();
    store.set("post-1", { aura: 12, userVote: 1 });
    expect(seen).toEqual([11]);
    // A write that changes nothing must not re-render every subscriber.
    expect(store.read("post-1", neutral).aura).toBe(12);
  });

  test("re-seeding an identical value does not notify", () => {
    const store = new EngagementStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    store.seed("post-1", neutral);
    store.seed("post-1", neutral);
    expect(notifications).toBe(1);
  });

  test("evicts the least-recently-used entry at capacity", () => {
    const store = new EngagementStore({ maxEntries: 2 });
    store.seed("a", { aura: 1 });
    store.seed("b", { aura: 2 });
    store.read("a", neutral);
    store.seed("c", { aura: 3 });
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
    expect(store.has("c")).toBe(true);
    expect(store.size).toBe(2);
  });

  test("clear drops the previous viewer's state on sign-out", () => {
    const store = new EngagementStore();
    store.seed("post-1", { aura: 9, isBookmarkedByUser: true, userVote: 1 });
    store.clear();
    expect(store.size).toBe(0);
    // The next viewer must not inherit the previous one's highlights.
    expect(
      store.read("post-1", { aura: 2, isBookmarkedByUser: false, userVote: 0 })
    ).toEqual({ aura: 2, isBookmarkedByUser: false, userVote: 0 });
  });

  test("seedMany notifies once for a whole page", () => {
    const store = new EngagementStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    store.seedMany(
      Array.from({ length: 25 }, (_, index) => [
        `post-${index}`,
        { aura: index, isBookmarkedByUser: false, userVote: 0 },
      ])
    );
    expect(store.size).toBe(25);
    expect(notifications).toBe(1);
  });
});

describe("EngagementStore with two components on one post", () => {
  test("a vote cluster mounting beside a bookmark toggle keeps both values", () => {
    const store = new EngagementStore();
    // The bookmark toggle seeds first, as it does higher in the card.
    store.seed("post-1", { isBookmarkedByUser: true });
    // The vote cluster then seeds only the fields it resolved. It must not
    // pass a placeholder isBookmarkedByUser, or the saved bookmark would
    // silently disappear from the toggle that is already on screen.
    store.seed("post-1", { aura: 12, userVote: 1 });
    expect(store.read("post-1", neutral)).toEqual({
      aura: 12,
      isBookmarkedByUser: true,
      userVote: 1,
    });
    // Order must not matter either.
    store.seed("post-2", { aura: 3, userVote: -1 });
    store.seed("post-2", { isBookmarkedByUser: true });
    expect(store.read("post-2", neutral)).toEqual({
      aura: 3,
      isBookmarkedByUser: true,
      userVote: -1,
    });
  });
});
