// Bounded stale-while-revalidate storage shared by the profile resources.
// Reads promote the least-recently-used key; capacity is never exceeded.

export const PROFILE_STALE_MS = 5 * 60 * 1000;
export const PROFILE_FEED_STALE_MS = 2 * 60 * 1000;

export interface ProfileResource<T> {
  data: T | null;
  error: string | null;
  fetchedAt: number;
  stale: boolean;
  status: "error" | "idle" | "loading" | "success";
}

const EMPTY_RESOURCE: ProfileResource<never> = {
  data: null,
  error: null,
  fetchedAt: 0,
  stale: false,
  status: "idle",
};

function emptyResource<T>(): ProfileResource<T> {
  return EMPTY_RESOURCE as ProfileResource<T>;
}

export class BoundedProfileCache<T> {
  private entries = new Map<string, ProfileResource<T>>();
  private listeners = new Set<() => void>();
  private maxEntries: number;
  private now: () => number;
  private staleMs: number;

  constructor(options: {
    maxEntries: number;
    now?: () => number;
    staleMs: number;
  }) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.now = options.now ?? Date.now;
    this.staleMs = options.staleMs;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.entries.delete(oldest.value);
    }
  }

  read(key: string): ProfileResource<T> {
    const entry = this.entries.get(key);
    if (!entry) {
      return emptyResource<T>();
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  isFresh(key: string): boolean {
    const entry = this.entries.get(key);
    return Boolean(entry && this.now() - entry.fetchedAt < this.staleMs);
  }

  patch(key: string, partial: Partial<Omit<ProfileResource<T>, "data">>): void {
    const current = this.read(key);
    this.entries.delete(key);
    this.entries.set(key, { ...current, ...partial });
    this.prune();
    this.notify();
  }

  setData(key: string, data: T): void {
    this.entries.delete(key);
    this.entries.set(key, {
      data,
      error: null,
      fetchedAt: this.now(),
      stale: false,
      status: "success",
    });
    this.prune();
    this.notify();
  }

  markStale(key: string): void {
    const current = this.read(key);
    this.entries.delete(key);
    this.entries.set(key, {
      ...current,
      error: null,
      stale: true,
      status: current.data === null ? "loading" : "success",
    });
    this.prune();
    this.notify();
  }

  setError(key: string, error: string): void {
    const current = this.read(key);
    this.entries.delete(key);
    this.entries.set(key, {
      ...current,
      error,
      stale: true,
      status: current.data === null ? "error" : "success",
    });
    this.prune();
    this.notify();
  }

  clear(): void {
    this.entries.clear();
    this.notify();
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }
}
