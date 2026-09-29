// Per-thread memory of messages whose payload has already been decrypted and
// proven NOT to be media, so the fullscreen viewer does not re-request the same
// imageless message windows every time the user navigates. The decryptor's own
// cache already dedupes in-flight/cached ids, but it evicts text entries under
// pressure while retaining media, so scanning a text-heavy stretch repeatedly
// would otherwise re-derive keys for the same messages.
//
// Only successful non-media resolutions are recorded. "error" is never recorded
// (it can heal once keys arrive), and media is never recorded (it is what the
// viewer is looking for). Because a ciphertext decrypts to the same payload
// every time, a recorded id can never become media later within a session.
//
// Pure and DOM-free so the cap and eviction order are unit-testable.

export interface ViewerScanCache {
  clear: () => void;
  delete: (id: string) => void;
  has: (id: string) => boolean;
  mark: (id: string) => void;
  size: () => number;
}

// Bounded so a very long session cannot grow this unboundedly. When full, the
// oldest scan records are dropped first (they are the least likely to be
// revisited), keeping the working set near the viewer.
const DEFAULT_SCAN_CACHE_CAP = 5000;

export function createViewerScanCache(
  cap = DEFAULT_SCAN_CACHE_CAP
): ViewerScanCache {
  // Insertion-ordered: iteration yields oldest first for eviction.
  const scanned = new Set<string>();

  function evictIfNeeded(): void {
    while (scanned.size > cap) {
      const oldest = scanned.values().next().value;
      if (oldest === undefined) {
        break;
      }
      scanned.delete(oldest);
    }
  }

  return {
    clear(): void {
      scanned.clear();
    },
    delete(id: string): void {
      scanned.delete(id);
    },
    has(id: string): boolean {
      return scanned.has(id);
    },
    mark(id: string): void {
      // Re-marking refreshes recency: delete-then-add moves the id to the MRU
      // end so a frequently revisited message survives eviction.
      scanned.delete(id);
      scanned.add(id);
      evictIfNeeded();
    },
    size(): number {
      return scanned.size;
    },
  };
}
