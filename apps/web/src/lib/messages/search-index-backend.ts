// Chooses the search index backend at runtime.
//
// Fail-tolerant by construction: the feature must never be the reason the
// transcript breaks. If IndexedDB is missing (server render, embedded webview),
// denied (private mode), or fails to open, the conversation falls back to an
// in-memory index for the session. Search then works for history loaded in this
// session and simply stops persisting — a degraded feature, not an error.
//
// The probe is injectable so the selection policy is unit-tested without a
// browser or an IndexedDB shim.

import { createIndexedDbSearchIndexStore } from "./indexeddb-search-index";
import { createMemorySearchIndexStore } from "./memory-search-index";
import type { SearchIndexStore } from "./search-index-format";

export type SearchIndexBackend = "indexeddb" | "memory";

async function tryIndexedDb(): Promise<SearchIndexStore | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  const store = createIndexedDbSearchIndexStore();
  try {
    // Prove the database actually opens before committing to it. A denied or
    // corrupt store throws here, which is exactly the case to catch: a backend
    // that cannot open would otherwise fail on the first write, after the user
    // already believed the index was working.
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

// Resolves the backend and returns a fresh store.
//
// Deliberately not cached. A cached store would hand one conversation's index to
// the next caller, and the failure would look like a corrupt index rather than a
// wiring mistake. The stores are cheap to build and the probe cost is paid once
// per conversation open rather than per keystroke.
export async function resolveSearchIndexStore(): Promise<ResolvedSearchIndex> {
  const persistent = await tryIndexedDb();
  return persistent
    ? { backend: "indexeddb", store: persistent }
    : { backend: "memory", store: createMemorySearchIndexStore() };
}

// Test seam. There is no cached state left to clear, so this only exists as one
// place to change if a caching decision is ever revisited.
export function resetSearchIndexStoreForTests(): void {
  // No cached state to clear.
}
