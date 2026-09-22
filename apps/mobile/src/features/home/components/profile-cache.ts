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

import type { PopupProfile } from "./profile-data";
import type { BioLinkPreview } from "./profile-utils";

// Matches web's profile query staleTime (mobile-top-bar.tsx).
export const POPUP_STALE_MS = 5 * 60 * 1000;

// Matches web's link-preview staleTime (link-badge.tsx).
export const LINK_PREVIEW_STALE_MS = 30 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export class PopupCache {
  private bookmarkTotals = new Map<string, CacheEntry<number>>();
  private linkPreviews = new Map<string, CacheEntry<BioLinkPreview>>();
  private maxEntries: number;
  private now: () => number;
  private profiles = new Map<string, CacheEntry<PopupProfile>>();

  constructor(now: () => number = Date.now, maxEntries = 20) {
    this.now = now;
    this.maxEntries = maxEntries;
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

  /** Cached profile regardless of age (shown while a refresh runs). */
  getStaleProfile(userId: string): PopupProfile | null {
    return this.profiles.get(userId)?.data ?? null;
  }

  /** Cached profile only when still fresh (served with no network). */
  getFreshProfile(userId: string): PopupProfile | null {
    const entry = this.profiles.get(userId);
    return this.isFresh(entry) ? (entry?.data ?? null) : null;
  }

  setProfile(userId: string, data: PopupProfile): void {
    this.profiles.set(userId, { data, fetchedAt: this.now() });
    this.prune(this.profiles);
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
  }

  /** Cached link preview (titles for bio pills), fresh or stale. */
  getLinkPreview(url: string): BioLinkPreview | null {
    return this.linkPreviews.get(url)?.data ?? null;
  }

  /** Cached link preview only when still fresh. */
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

  /** Drops one user's entries, or everything when no id is given. */
  invalidate(userId?: string): void {
    if (!userId) {
      this.clear();
      return;
    }
    this.bookmarkTotals.delete(userId);
    this.profiles.delete(userId);
  }

  /** Drops everything. Call on logout so the next account starts clean. */
  clear(): void {
    this.bookmarkTotals.clear();
    this.linkPreviews.clear();
    this.profiles.clear();
  }
}

/** Process-wide popup cache used by the hook. */
export const popupCache = new PopupCache();
