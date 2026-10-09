// Chooses the search index backend at runtime. Fail-tolerant: if IndexedDB is
// missing, denied, or fails to open, fall back to a session-only in-memory
// index rather than breaking the transcript.

import { createIndexedDbSearchIndexStore } from "./indexeddb-search-index";
import { createMemorySearchIndexStore } from "./memory-search-index";
import { clearAllSearchIndexScopes } from "./scoped-search-index";
import type { SearchIndexStore } from "./search-index-format";

export type SearchIndexBackend = "indexeddb" | "memory";

async function tryIndexedDb(): Promise<SearchIndexStore | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  const store = createIndexedDbSearchIndexStore();
  try {
    // Prove the database opens before committing to it.
    await store.readMeta("__probe__");
    return store;
  } catch {
    return null;
  }
}

export interface ResolvedSearchIndex {
  backend: SearchIndexBackend;
  store: SearchIndexStore;
}

// Deliberately not cached: a shared store would hand one conversation's index
// to the next caller. Stores are cheap; the probe runs once per conversation
// open, not per keystroke.
export async function resolveSearchIndexStore(): Promise<ResolvedSearchIndex> {
  const persistent = await tryIndexedDb();
  return persistent
    ? { backend: "indexeddb", store: persistent }
    : { backend: "memory", store: createMemorySearchIndexStore() };
}

let legacySearchRetirement: Promise<boolean> | null = null;

export function retireLegacySearchIndex(): Promise<boolean> {
  if (legacySearchRetirement) {
    return legacySearchRetirement;
  }
  const pending = (async () => {
    try {
      const resolved = await resolveSearchIndexStore();
      if (resolved.backend !== "indexeddb") {
        return false;
      }
      return await clearAllSearchIndexScopes(resolved.store);
    } catch {
      return false;
    }
  })();
  legacySearchRetirement = pending;
  void (async () => {
    const succeeded = await pending;
    if (!succeeded && legacySearchRetirement === pending) {
      legacySearchRetirement = null;
    }
  })();
  return pending;
}

// Test seam; reset the cutover cleanup so another test can exercise it.
export function resetSearchIndexStoreForTests(): void {
  legacySearchRetirement = null;
}
