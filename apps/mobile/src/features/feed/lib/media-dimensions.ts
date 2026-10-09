import { orderedCopy } from "@/lib/ordered-copy";
import { emptySnapshot } from "@/lib/persistent-cache";
import type { PersistSnapshot, PersistedEntry } from "@/lib/persistent-cache";

export interface MediaDimensions {
  height: number;
  width: number;
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_NAME = "media-dimensions-v1";

export function mediaDimensionsKey(apiBase: string, mediaId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/media/${mediaId}`;
}

function isDimensions(value: unknown): value is MediaDimensions {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const dimensions = value as Partial<MediaDimensions>;
  return (
    typeof dimensions.width === "number" &&
    typeof dimensions.height === "number" &&
    Number.isFinite(dimensions.width) &&
    Number.isFinite(dimensions.height) &&
    dimensions.width > 0 &&
    dimensions.height > 0
  );
}

export class MediaDimensionsCache {
  private readonly entries = new Map<string, PersistedEntry<MediaDimensions>>();
  private readonly now: () => number;
  private readonly limit: number;
  constructor(now: () => number = Date.now, limit = 512) {
    this.now = now;
    this.limit = limit;
  }

  get(key: string): MediaDimensions | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (
      this.now() - entry.fetchedAt > RETENTION_MS ||
      entry.fetchedAt > this.now()
    ) {
      this.entries.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, dimensions: MediaDimensions): boolean {
    if (!isDimensions(dimensions)) {
      return false;
    }
    const previous = this.get(key);
    if (
      previous?.width === dimensions.width &&
      previous.height === dimensions.height
    ) {
      return false;
    }
    this.entries.delete(key);
    this.entries.set(key, { data: dimensions, fetchedAt: this.now() });
    this.trim();
    return true;
  }

  private trim(): void {
    while (this.entries.size > Math.max(1, this.limit)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  snapshot(): PersistSnapshot<MediaDimensions> {
    const snapshot = emptySnapshot<MediaDimensions>();
    for (const [key, entry] of this.entries) {
      if (this.get(key)) {
        snapshot.entries[key] = entry;
      }
    }
    return snapshot;
  }

  restore(snapshot: PersistSnapshot<unknown>): void {
    const entries = orderedCopy(
      Object.entries(snapshot.entries),
      (a, b) => a[1].fetchedAt - b[1].fetchedAt
    );
    for (const [key, entry] of entries) {
      if (
        !this.entries.has(key) &&
        isDimensions(entry.data) &&
        Number.isFinite(entry.fetchedAt) &&
        entry.fetchedAt <= this.now() &&
        this.now() - entry.fetchedAt <= RETENTION_MS
      ) {
        this.entries.set(key, { data: entry.data, fetchedAt: entry.fetchedAt });
      }
    }
    this.trim();
  }
}

export const mediaDimensionsCache = new MediaDimensionsCache();
let hydration: Promise<void> | null = null;
export function hydrateMediaDimensions(): Promise<void> {
  hydration ??= (async () => {
    const { readSnapshot } = await import("@/lib/persistent-file");
    mediaDimensionsCache.restore(await readSnapshot<unknown>(CACHE_NAME));
  })();
  return hydration;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
export function rememberMediaDimensions(
  key: string,
  dimensions: MediaDimensions
): void {
  if (!mediaDimensionsCache.set(key, dimensions) || persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void (async () => {
      try {
        const { writeSnapshot } = await import("@/lib/persistent-file");
        await writeSnapshot(CACHE_NAME, mediaDimensionsCache.snapshot());
      } catch {
        // Image geometry persistence must never interrupt media rendering.
      }
    })();
  }, 800);
}
