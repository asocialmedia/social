import { beforeEach, describe, expect, test } from "bun:test";

import type { StateStorage } from "zustand/middleware";

import {
  createTabMemoryStore,
  isTabValue,
  HOME_TABS,
  resolveExploreTab,
  resolveHomeTab,
  resolveProfileTab,
  TAB_MEMORY_TTL_MS,
} from "./tab-store";

function memoryStorage(): StateStorage & { backing: Map<string, string> } {
  const backing = new Map<string, string>();
  return {
    backing,
    getItem: (name: string) => backing.get(name) ?? null,
    removeItem: (name: string) => {
      backing.delete(name);
    },
    setItem: (name: string, value: string) => {
      backing.set(name, value);
    },
  };
}

describe("isTabValue", () => {
  test("validates membership", () => {
    expect(isTabValue(HOME_TABS, "latest")).toBe(true);
    expect(isTabValue(HOME_TABS, "nope")).toBe(false);
    expect(isTabValue(HOME_TABS, null)).toBe(false);
  });
});

describe("resolveHomeTab", () => {
  test("param wins, then memory, then default", () => {
    expect(resolveHomeTab("trending", true, null, true)).toBe("trending");
    expect(
      resolveHomeTab(
        null,
        true,
        { updatedAt: Date.now(), value: "latest" },
        true
      )
    ).toBe("latest");
    expect(resolveHomeTab(null, true, null, true)).toBe("personalized");
    expect(resolveHomeTab(null, false, null, true)).toBe("latest");
  });

  test("ignores memory before hydration and stale memory", () => {
    const stored = { updatedAt: Date.now(), value: "latest" as const };
    expect(resolveHomeTab(null, true, stored, false)).toBe("personalized");
    expect(
      resolveHomeTab(
        null,
        true,
        { updatedAt: Date.now() - TAB_MEMORY_TTL_MS - 1, value: "latest" },
        true
      )
    ).toBe("personalized");
  });
});

describe("resolveExploreTab", () => {
  test("guests fall back when memory is auth-gated", () => {
    expect(
      resolveExploreTab(
        null,
        false,
        { updatedAt: Date.now(), value: "for-you" },
        true
      )
    ).toBe("trending");
    expect(
      resolveExploreTab(
        null,
        false,
        { updatedAt: Date.now(), value: "gusts" },
        true
      )
    ).toBe("gusts");
  });
});

describe("resolveProfileTab", () => {
  test("defaults to posts and gates guests", () => {
    expect(resolveProfileTab(null, true, true)).toBe("posts");
    expect(
      resolveProfileTab(
        { updatedAt: Date.now(), value: "responses" },
        false,
        true
      )
    ).toBe("posts");
    expect(
      resolveProfileTab({ updatedAt: Date.now(), value: "media" }, false, true)
    ).toBe("media");
  });
});

describe("tab memory store", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  test("remembers and prunes the home tab", () => {
    const store = createTabMemoryStore(storage);
    expect(store.getState().home).toBeNull();
    store.getState().setHomeTab("trending");
    expect(store.getState().home?.value).toBe("trending");
    store.getState().resetTabMemory();
    expect(store.getState().home).toBeNull();
  });

  test("sanitizes hostile persisted payloads", async () => {
    storage.backing.set(
      "asm-tab-memory",
      JSON.stringify({
        state: {
          explore: null,
          home: { updatedAt: Date.now(), value: "hacked" },
          profileByUserId: { u1: { updatedAt: "soon", value: "posts" } },
        },
        version: 1,
      })
    );
    const store = createTabMemoryStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().home).toBeNull();
    expect(store.getState().profileByUserId).toEqual({});
  });

  test("rehydrates a valid payload", async () => {
    storage.backing.set(
      "asm-tab-memory",
      JSON.stringify({
        state: {
          explore: null,
          home: { updatedAt: Date.now(), value: "following" },
          profileByUserId: {},
        },
        version: 1,
      })
    );
    const store = createTabMemoryStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().home?.value).toBe("following");
  });
});
