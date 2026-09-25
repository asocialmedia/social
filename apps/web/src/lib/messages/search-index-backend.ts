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

let resolved: { backend: SearchIndexBackend; store: SearchIndexStore } | null =
  null;

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

// Resolves once per session and caches the result, so a denied database is
// probed once rather than on every keystroke batch.
export async function resolveSearchIndexStore(): Promise<ResolvedSearchIndex> {
  if (resolved) {
    return resolved;
  }
  const persistent = await tryIndexedDb();
  resolved = persistent
    ? { backend: "indexeddb", store: persistent }
    : { backend: "memory", store: createMemorySearchIndexStore() };
  return resolved;
}

// Test seam: drops the cached resolution so a test can exercise the fallback
// with a different availability probe.
export function resetSearchIndexStoreForTests(): void {
  resolved = null;
}
