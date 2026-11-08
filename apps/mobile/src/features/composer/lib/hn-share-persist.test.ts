import { describe, expect, test } from "bun:test";

import type { HnShareDraft } from "../state/composer-store";
import {
  clearPendingHnShare,
  decodePendingHnShare,
  encodePendingHnShare,
  loadPendingHnShare,
  savePendingHnShare,
} from "./hn-share-persist";
import type { HnShareStorage } from "./hn-share-persist";

function memoryStorage(): HnShareStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => Promise.resolve(items.get(key) ?? null),
    items,
    removeItem: (key: string) => {
      items.delete(key);
      return Promise.resolve();
    },
    setItem: (key: string, value: string) => {
      items.set(key, value);
      return Promise.resolve();
    },
  };
}

const STORY: HnShareDraft = {
  by: "pg",
  descendants: 42,
  score: 900,
  storyId: 123,
  time: 1_700_000_000,
  title: "A story worth sharing",
  url: "https://example.com/story",
};

describe("pending HN share persistence", () => {
  test("round-trips a story through save and load", async () => {
    const storage = memoryStorage();
    await savePendingHnShare(storage, STORY);
    expect(await loadPendingHnShare(storage)).toEqual(STORY);
  });

  test("clear removes the pending share", async () => {
    const storage = memoryStorage();
    await savePendingHnShare(storage, STORY);
    await clearPendingHnShare(storage);
    expect(await loadPendingHnShare(storage)).toBeNull();
  });

  test("older storage versions are dropped", () => {
    expect(
      decodePendingHnShare(JSON.stringify({ story: STORY, version: 0 }))
    ).toBeNull();
  });

  test("corrupt payloads decode to null", () => {
    expect(decodePendingHnShare("not-json{")).toBeNull();
    expect(decodePendingHnShare(null)).toBeNull();
    expect(decodePendingHnShare(JSON.stringify({ version: 1 }))).toBeNull();
  });

  test("stories without identity never persist", async () => {
    const storage = memoryStorage();
    expect(
      encodePendingHnShare({ storyId: 0, title: "" } as HnShareDraft)
    ).toBeNull();
    await savePendingHnShare(storage, { storyId: 1 } as HnShareDraft);
    expect(storage.items.size).toBe(0);
  });

  test("missing optional fields decode to null, not undefined", async () => {
    const storage = memoryStorage();
    await storage.setItem(
      "asm-pending-hn-share",
      JSON.stringify({ story: { storyId: 7, title: "T" }, version: 1 })
    );
    expect(await loadPendingHnShare(storage)).toEqual({
      by: null,
      descendants: null,
      score: null,
      storyId: 7,
      time: null,
      title: "T",
      url: null,
    });
  });
});
