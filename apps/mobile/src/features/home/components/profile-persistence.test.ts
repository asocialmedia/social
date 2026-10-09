import { describe, expect, test } from "bun:test";

import { POPUP_STALE_MS, PopupCache, popupProfileKey } from "./profile-cache";
import { parsePopupProfile } from "./profile-data";
import type { PopupProfile } from "./profile-data";

function profile(
  avatarUrl = "/api/users/avatar/reader/image?v=custom.png"
): PopupProfile {
  const parsed = parsePopupProfile({ avatarUrl, username: "reader" });
  if (!parsed) {
    throw new Error("Invalid profile fixture");
  }
  return parsed;
}

describe("persistent viewer profile metadata", () => {
  test("a cold process restores the custom avatar and original freshness", () => {
    let now = 1000;
    const key = popupProfileKey("https://asocialmedia.cc", "reader");
    const previous = new PopupCache(() => now);
    previous.setProfile(key, profile());
    previous.setBookmarkTotal(key, 0);
    const saved = structuredClone(previous.snapshot());
    now += 10_000;
    const restarted = new PopupCache(() => now);
    restarted.restore(saved);
    expect(restarted.getFreshProfile(key)?.avatarUrl).toBe(profile().avatarUrl);
    expect(restarted.getFreshBookmarkTotal(key)).toBe(0);
    now += POPUP_STALE_MS;
    expect(restarted.getFreshProfile(key)).toBeNull();
    expect(restarted.getStaleProfile(key)?.avatarUrl).toBe(profile().avatarUrl);
  });

  test("API and account changes cannot select another viewer's persisted avatar", () => {
    const cache = new PopupCache();
    cache.setProfile(
      popupProfileKey("https://production.example", "a"),
      profile()
    );
    const fresh = new PopupCache();
    fresh.restore(cache.snapshot());
    expect(
      fresh.getStaleProfile(popupProfileKey("https://production.example", "b"))
    ).toBeNull();
    expect(
      fresh.getStaleProfile(popupProfileKey("https://development.example", "a"))
    ).toBeNull();
    expect(popupProfileKey("https://production.example/", "a")).toBe(
      popupProfileKey("https://production.example", "a")
    );
  });

  test("hydration cannot overwrite live metadata or revive invalidated entries", () => {
    const old = new PopupCache();
    old.setProfile("a", profile("old.png"));
    old.setProfile("b", profile("b.png"));
    const live = new PopupCache();
    live.setProfile("a", profile("new.png"));
    live.invalidate("b");
    live.restore(old.snapshot());
    expect(live.getStaleProfile("a")?.avatarUrl).toBe("new.png");
    expect(live.getStaleProfile("b")).toBeNull();
    live.clear();
    live.restore(old.snapshot());
    expect(live.getStaleProfile("a")).toBeNull();
  });

  test("rejects expired, future and malformed snapshots and bounds retained profiles", () => {
    const cache = new PopupCache(() => 1_000_000_000, 2);
    cache.restore({
      bookmarkTotals: {},
      profiles: {
        a: { data: profile(), fetchedAt: 999_999_999 },
        b: { data: profile(), fetchedAt: 999_999_999 },
        c: { data: profile(), fetchedAt: 999_999_999 },
        future: { data: profile(), fetchedAt: 1_000_000_001 },
        invalid: {
          data: { ...profile(), username: "" },
          fetchedAt: 999_999_999,
        },
        old: { data: profile(), fetchedAt: 0 },
      },
    });
    expect(Object.keys(cache.snapshot().profiles)).toEqual(["b", "c"]);
  });

  test("concurrent consumers share one request and fresh cold caches perform no request", async () => {
    const cache = new PopupCache();
    let calls = 0;
    const pending = Promise.withResolvers<PopupProfile>();
    const loader = () => {
      calls += 1;
      return pending.promise;
    };
    const first = cache.loadProfile("reader", loader);
    const second = cache.loadProfile("reader", loader);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    pending.resolve(profile());
    await first;
    const restarted = new PopupCache();
    restarted.restore(cache.snapshot());
    expect(await restarted.loadProfile("reader", loader)).toEqual(profile());
    expect(calls).toBe(1);
    let bookmarks = 0;
    const bookmarkLoader = () => {
      bookmarks += 1;
      return Promise.resolve(0);
    };
    await Promise.all([
      cache.loadBookmarkTotal("reader", bookmarkLoader),
      cache.loadBookmarkTotal("reader", bookmarkLoader),
    ]);
    expect(bookmarks).toBe(1);
  });

  test("failed requests remain retryable and logout cannot persist a late response", async () => {
    const cache = new PopupCache();
    await expect(
      cache.loadProfile("reader", () => {
        throw new Error("offline");
      })
    ).rejects.toThrow("offline");
    expect(
      await cache.loadProfile("reader", () => Promise.resolve(profile()))
    ).toEqual(profile());
    cache.invalidate("reader");
    const pending = Promise.withResolvers<PopupProfile>();
    const oldRequest = cache.loadProfile("reader", () => pending.promise);
    await Promise.resolve();
    cache.clear();
    pending.resolve(profile("late.png"));
    await oldRequest;
    expect(cache.getStaleProfile("reader")).toBeNull();
  });
});
