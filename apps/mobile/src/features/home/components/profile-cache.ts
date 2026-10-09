// Tiny stale-while-revalidate store for the profile popup, mirroring web's
// React Query usage (5-minute staleTime on the profile query, shared
// bookmark-count cache). Mobile has no React Query, so this module holds the
// same semantics without the dependency: fresh entries serve instantly with
// no network, stale entries serve while a refresh is in flight, and failures
// keep stale data instead of erroring.
//
// Pure (no React imports): the clock and capacity are injectable for tests.
// Keyed by user id throughout so switching accounts can never show another
// user's cached profile; call clear() on logout as a second guard.

import { parsePopupProfile } from "./profile-data";
import type { PopupProfile } from "./profile-data";
import type { BioLinkPreview } from "./profile-utils";

// Matches web's profile query staleTime (mobile-top-bar.tsx).
export const POPUP_STALE_MS = 5 * 60 * 1000;

// Matches web's link-preview staleTime (link-badge.tsx).
export const LINK_PREVIEW_STALE_MS = 30 * 60 * 1000;

export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export interface PopupCacheSnapshot {
  bookmarkTotals: Record<string, CacheEntry<number>>;
  profiles: Record<string, CacheEntry<PopupProfile>>;
}

export function popupProfileKey(apiBase: string, userId: string): string {
  return JSON.stringify([apiBase.replace(/\/+$/, ""), userId]);
}

const PROFILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class PopupCache {
  private bookmarkTotals = new Map<string, CacheEntry<number>>();
  private linkPreviews = new Map<string, CacheEntry<BioLinkPreview>>();
  private maxEntries: number;
  private now: () => number;
  private profiles = new Map<string, CacheEntry<PopupProfile>>();

  private generation = 0;
  private invalidatedKeys = new Set<string>();
  private profileFlights = new Map<string, Promise<PopupProfile>>();
  private bookmarkFlights = new Map<string, Promise<number>>();
  private onChange: () => void;
  private discardRestored = false;

  constructor(
    now: () => number = Date.now,
    maxEntries = 20,
    onChange: () => void = () => null
  ) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.onChange = onChange;
  }

  private isFresh<T>(
    entry: CacheEntry<T> | undefined,
    staleMs: number = POPUP_STALE_MS
  ): entry is CacheEntry<T> {
    return entry !== undefined && this.now() - entry.fetchedAt < staleMs;
  }

  private prune(map: Map<string, CacheEntry<unknown>>): void {
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next();
      if (oldest.done) {
        return;
      }
      map.delete(oldest.value);
    }
  }

  // Cached profile regardless of age (shown while a refresh runs).
  getStaleProfile(userId: string): PopupProfile | null {
    return this.profiles.get(userId)?.data ?? null;
  }

  // Cached profile only when still fresh (served with no network).
  getFreshProfile(userId: string): PopupProfile | null {
    const entry = this.profiles.get(userId);
    return this.isFresh(entry) ? (entry?.data ?? null) : null;
  }

  setProfile(userId: string, data: PopupProfile): void {
    this.profiles.set(userId, { data, fetchedAt: this.now() });
    this.prune(this.profiles);
    this.onChange();
  }

  getStaleBookmarkTotal(userId: string): number | null {
    return this.bookmarkTotals.get(userId)?.data ?? null;
  }

  getFreshBookmarkTotal(userId: string): number | null {
    const entry = this.bookmarkTotals.get(userId);
    return this.isFresh(entry) ? (entry?.data ?? null) : null;
  }

  setBookmarkTotal(userId: string, total: number): void {
    this.bookmarkTotals.set(userId, { data: total, fetchedAt: this.now() });
    this.prune(this.bookmarkTotals);
    this.onChange();
  }

  snapshot(): PopupCacheSnapshot {
    return {
      bookmarkTotals: Object.fromEntries(this.bookmarkTotals),
      profiles: Object.fromEntries(this.profiles),
    };
  }

  restore(snapshot: PopupCacheSnapshot): void {
    if (this.discardRestored) {
      return;
    }
    const now = this.now();
    const retained = (entry: CacheEntry<unknown>): boolean =>
      Number.isFinite(entry.fetchedAt) &&
      entry.fetchedAt <= now &&
      now - entry.fetchedAt < PROFILE_RETENTION_MS;
    for (const [key, entry] of Object.entries(snapshot.profiles ?? {})) {
      if (
        !entry ||
        !retained(entry) ||
        this.profiles.has(key) ||
        this.invalidatedKeys.has(key)
      ) {
        continue;
      }
      const profile = parsePopupProfile(entry.data);
      if (profile) {
        this.profiles.set(key, { data: profile, fetchedAt: entry.fetchedAt });
      }
    }
    for (const [key, entry] of Object.entries(snapshot.bookmarkTotals ?? {})) {
      if (
        entry &&
        retained(entry) &&
        !this.bookmarkTotals.has(key) &&
        !this.invalidatedKeys.has(key) &&
        typeof entry.data === "number" &&
        Number.isFinite(entry.data)
      ) {
        this.bookmarkTotals.set(key, entry);
      }
    }
    this.prune(this.profiles);
    this.prune(this.bookmarkTotals);
  }

  loadProfile(
    key: string,
    loader: () => Promise<PopupProfile>
  ): Promise<PopupProfile> {
    const cached = this.getFreshProfile(key);
    return cached
      ? Promise.resolve(cached)
      : this.loadSingleFlight(key, this.profileFlights, loader, (profile) =>
          this.setProfile(key, profile)
        );
  }

  loadBookmarkTotal(
    key: string,
    loader: () => Promise<number>
  ): Promise<number> {
    const cached = this.getFreshBookmarkTotal(key);
    return cached === null
      ? this.loadSingleFlight(key, this.bookmarkFlights, loader, (total) =>
          this.setBookmarkTotal(key, total)
        )
      : Promise.resolve(cached);
  }

  private loadSingleFlight<T>(
    key: string,
    flights: Map<string, Promise<T>>,
    loader: () => Promise<T>,
    save: (data: T) => void
  ): Promise<T> {
    const pending = flights.get(key);
    if (pending) {
      return pending;
    }
    const { generation } = this;
    let request: Promise<T> | null = null;
    request = (async () => {
      await Promise.resolve();
      try {
        const data = await loader();
        if (generation === this.generation) {
          save(data);
        }
        return data;
      } finally {
        if (flights.get(key) === request) {
          flights.delete(key);
        }
      }
    })();
    flights.set(key, request);
    return request;
  }

  // Cached link preview (titles for bio pills), fresh or stale.
  getLinkPreview(url: string): BioLinkPreview | null {
    return this.linkPreviews.get(url)?.data ?? null;
  }

  // Cached link preview only when still fresh.
  getFreshLinkPreview(url: string): BioLinkPreview | null {
    const entry = this.linkPreviews.get(url);
    return this.isFresh(entry, LINK_PREVIEW_STALE_MS)
      ? (entry?.data ?? null)
      : null;
  }

  setLinkPreview(url: string, preview: BioLinkPreview): void {
    this.linkPreviews.set(url, { data: preview, fetchedAt: this.now() });
    this.prune(this.linkPreviews);
  }

  // Drops one user's entries, or everything when no id is given.
  invalidate(userId?: string): void {
    if (!userId) {
      this.clear();
      return;
    }
    this.invalidatedKeys.add(userId);
    this.generation += 1;
    this.bookmarkFlights.delete(userId);
    this.profileFlights.delete(userId);
    this.bookmarkTotals.delete(userId);
    this.profiles.delete(userId);
    this.onChange();
  }

  // Drops everything. Call on logout so the next account starts clean.
  clear(): void {
    this.bookmarkTotals.clear();
    this.linkPreviews.clear();
    this.profiles.clear();
    this.profileFlights.clear();
    this.bookmarkFlights.clear();
    this.generation += 1;
    this.discardRestored = true;
    this.onChange();
  }
}

// Process-wide popup cache used by the hook.
export const popupCache = new PopupCache(Date.now, 20, schedulePopupPersist);
const POPUP_CACHE_NAME = "popup-profiles-v1";
let hydration: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function hydratePopupCache(): Promise<void> {
  hydration ??= (async () => {
    try {
      const { readSnapshot } = await import("@/lib/persistent-file");
      const snapshot = await readSnapshot<PopupCacheSnapshot>(POPUP_CACHE_NAME);
      const cached = snapshot.entries["popup"]?.data;
      if (cached && typeof cached === "object") {
        popupCache.restore(cached);
      }
    } catch {
      // Missing or corrupt metadata must not prevent loading the profile.
    }
  })();
  return hydration;
}

function schedulePopupPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void (async () => {
      try {
        await hydratePopupCache();
        const { writeSnapshot } = await import("@/lib/persistent-file");
        await writeSnapshot(POPUP_CACHE_NAME, {
          entries: {
            popup: { data: popupCache.snapshot(), fetchedAt: Date.now() },
          },
          version: 1,
        });
      } catch {
        // Cache IO must never prevent rendering the avatar or profile.
      }
    })();
  }, 150);
}
