import { describe, expect, test } from "bun:test";

import type { StateStorage } from "zustand/middleware";

import { createVideoCaptionsStore } from "./video-captions-store";

function memoryStorage(): StateStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(items.get(key) ?? null),
    items,
    removeItem: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
    setItem: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("video captions preference", () => {
  test("defaults on and toggles", () => {
    const store = createVideoCaptionsStore(memoryStorage());
    expect(store.getState().showCaptions).toBe(true);
    store.getState().toggleCaptions();
    expect(store.getState().showCaptions).toBe(false);
    store.getState().setShowCaptions(true);
    expect(store.getState().showCaptions).toBe(true);
  });

  test("a toggled preference rehydrates in a fresh store", async () => {
    const storage = memoryStorage();
    const first = createVideoCaptionsStore(storage);
    first.getState().setShowCaptions(false);
    const second = createVideoCaptionsStore(storage);
    await second.persist.rehydrate();
    expect(second.getState().showCaptions).toBe(false);
  });
});
