// Persistent TTL cache for the native app.
// Small values live in SecureStore, large feed/profile payloads live as JSON
// files in the expo-file-system cache directory. Every read is
// stale-while-revalidate: a fresh entry renders instantly, a stale one renders
// too while the caller refetches in the background. All IO is best-effort and
// never throws, so storage can never break the UI.
// Pure helpers (isFreshEntry, pruneSnapshot) are unit-testable on Node without
// pulling in react-native or expo modules.
export const PERSIST_VERSION = 1;

// A single cached value with its write time.
export interface PersistedEntry<T> {
  data: T;
  fetchedAt: number;
}

// Whole-file snapshot: one JSON file per cache name.
export interface PersistSnapshot<T> {
  entries: Record<string, PersistedEntry<T>>;
  version: number;
}

// True when the entry exists and is younger than ttlMs.
export function isFreshEntry(
  entry: PersistedEntry<unknown> | null | undefined,
  now: number,
  ttlMs: number
): boolean {
  if (!entry) {
    return false;
  }
  if (!Number.isFinite(entry.fetchedAt) || entry.fetchedAt > now) {
    return false;
  }
  return now - entry.fetchedAt <= ttlMs;
}

// Builds an empty snapshot for a cache name.
export function emptySnapshot<T>(): PersistSnapshot<T> {
  return { entries: {}, version: PERSIST_VERSION };
}

// Drops expired entries and caps the map at maxEntries (oldest first).
// Pure so tests can pin the eviction order without touching the filesystem.
export function pruneSnapshot<T>(
  snapshot: PersistSnapshot<T>,
  now: number,
  ttlMs: number,
  maxEntries: number
): PersistSnapshot<T> {
  const fresh: [string, PersistedEntry<T>][] = [];
  for (const [key, entry] of Object.entries(snapshot.entries)) {
    if (isFreshEntry(entry, now, ttlMs)) {
      fresh.push([key, entry]);
    }
  }
  // Oldest first so the slice keeps the newest.
  fresh.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const kept = fresh.slice(Math.max(0, fresh.length - Math.max(1, maxEntries)));
  return { entries: Object.fromEntries(kept), version: PERSIST_VERSION };
}

// Parses a snapshot file body. Returns empty on any shape mismatch so a
// corrupt or older file never breaks hydration.
export function parseSnapshot<T>(
  raw: string | null | undefined
): PersistSnapshot<T> {
  if (!raw) {
    return emptySnapshot<T>();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistSnapshot<T>>;
    if (typeof parsed !== "object" || parsed === null) {
      return emptySnapshot<T>();
    }
    if (parsed.version !== PERSIST_VERSION) {
      return emptySnapshot<T>();
    }
    const { entries } = parsed;
    if (typeof entries !== "object" || entries === null) {
      return emptySnapshot<T>();
    }
    const clean: Record<string, PersistedEntry<T>> = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const candidate = entry as Partial<PersistedEntry<T>>;
      if (!Number.isFinite(candidate.fetchedAt)) {
        continue;
      }
      if (!("data" in candidate)) {
        continue;
      }
      clean[key] = {
        data: candidate.data as T,
        fetchedAt: candidate.fetchedAt as number,
      };
    }
    return { entries: clean, version: PERSIST_VERSION };
  } catch {
    return emptySnapshot<T>();
  }
}

// Serializes a snapshot for writing.
export function serializeSnapshot<T>(snapshot: PersistSnapshot<T>): string {
  return JSON.stringify(snapshot);
}

// File name for a cache. Kept flat in the cache dir so it is easy to inspect
// with expo-file-system tooling.
export function snapshotFileName(cacheName: string): string {
  const safe = cacheName
    .trim()
    .replaceAll(/[^a-z0-9-_]+/gi, "-")
    .toLowerCase();
  return `asm-${safe || "cache"}.json`;
}
