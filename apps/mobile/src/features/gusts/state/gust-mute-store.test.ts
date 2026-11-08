import { describe, expect, test } from "bun:test";

import type { GustMuteStorage } from "./gust-mute-store";
import { createGustMuteStore } from "./gust-mute-store";

function deferredStorage(): GustMuteStorage & {
  release: () => void;
  values: string[];
} {
  const values: string[] = [];
  const { promise: gate, resolve: release } =
    Promise.withResolvers<undefined>();
  return {
    getItem: () => Promise.resolve(null),
    release: () => release(),
    setItem: (_key: string, value: string) => {
      values.push(value);
      return gate.then(() => {});
    },
    values,
  };
}

describe("gust mute persistence", () => {
  test("rapid toggles persist in tap order, not completion order", async () => {
    const storage = deferredStorage();
    const store = createGustMuteStore(storage);
    // Tap twice while the first write is still gated: without serialization
    // the gated write would land last and persist the inverse value.
    store.getState().toggleMuted();
    store.getState().toggleMuted();
    expect(store.getState().isMuted).toBe(true);
    storage.release();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(storage.values).toEqual(["false", "true"]);
  });

  test("a failed write does not break later toggles", async () => {
    let calls = 0;
    const storage: GustMuteStorage = {
      getItem: () => Promise.resolve(null),
      setItem: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("keystore locked"))
          : Promise.resolve();
      },
    };
    const store = createGustMuteStore(storage);
    store.getState().toggleMuted();
    store.getState().toggleMuted();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(calls).toBe(2);
    expect(store.getState().isMuted).toBe(true);
  });

  test("hydrate keeps the default when nothing is stored", async () => {
    const store = createGustMuteStore({
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.resolve(),
    });
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().isMuted).toBe(true);
  });

  test("hydrate restores an unmuted preference", async () => {
    const store = createGustMuteStore({
      getItem: () => Promise.resolve("false"),
      setItem: () => Promise.resolve(),
    });
    await store.getState().hydrate();
    expect(store.getState().isMuted).toBe(false);
  });
});
