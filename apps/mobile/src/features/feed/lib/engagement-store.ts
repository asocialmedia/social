// Per-post viewer state (own vote + own bookmark), shared by every surface
// that shows the post: feed cards, the detail screen, the media viewer, the
// explore grid, gust cards and eddie threads.
//
// This exists because the per-card components used to answer two questions
// with two requests on every mount:
//
//   GET /api/posts/:id/votes      -> aura, userVote
//   GET /api/posts/:id/bookmark   -> isBookmarkedByUser
//
// A feed page mounts every card at once, so one page load fired 2 requests per
// post (~50 for a 25-post page). Each one is a separate web route handler that
// independently calls getSessionFromApi(), a real HTTP round trip to the auth
// service, which is what buried the dev logs in
// `request completed /api/auth/get-session` lines.
//
// None of it was needed. The feed payload is already viewer-resolved: the query
// scopes `votes` and `bookmarks` to the logged-in user (packages/db client
// getPostDataQuery) and mapPostData ships both back. The card had the correct
// value on first paint and then went to the network to fetch it again.
//
// This store is the web `useQuery` cache (staleTime + refetchOnMount: false)
// in the same framework-free shape as feedCache and BoundedProfileCache:
//   - seed() publishes the payload's answer for a post, no request;
//   - read() is what components render, so they never fetch to paint;
//   - a mutation writes through, so every surface updates at once;
//   - refresh() is explicit and deduped, for a genuine re-read.
//
// Pure: no React Native or Expo imports, so it is unit-testable on Node.

import { fetchBookmarkInfo, fetchVoteInfo } from "./feed-api";
import type { ApiCallOptions } from "./feed-api";

// Web's aura-vote-button staleTime. Long enough that a re-read almost never
// fires mid-session, short enough that coming back to a post hours later
// re-reads it.
export const ENGAGEMENT_STALE_MS = 5 * 60 * 1000;

// Roughly a few screens of scrolling. The store caches what the feed already
// gave us, so holding a couple of pages keeps scroll-back free while still
// bounding memory on a long session.
export const ENGAGEMENT_CACHE_LIMIT = 200;

export interface PostEngagement {
  aura: number;
  isBookmarkedByUser: boolean;
  userVote: number;
}

interface EngagementEntry extends PostEngagement {
  // When this entry was last confirmed against the server.
  confirmedAt: number;
  // Cached, referentially stable snapshot for useSyncExternalStore.
  snapshot: PostEngagement;
}

// Coerces anything into a usable engagement value, defaulting to no state.
export function normalizeEngagement(
  value: Partial<PostEngagement> | null | undefined
): PostEngagement {
  return {
    aura: typeof value?.aura === "number" ? value.aura : 0,
    isBookmarkedByUser: value?.isBookmarkedByUser === true,
    userVote: typeof value?.userVote === "number" ? value.userVote : 0,
  };
}

function sameEngagement(a: PostEngagement, b: PostEngagement): boolean {
  return (
    a.aura === b.aura &&
    a.isBookmarkedByUser === b.isBookmarkedByUser &&
    a.userVote === b.userVote
  );
}

export class EngagementStore {
  private entries = new Map<string, EngagementEntry>();
  private inflight = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private maxEntries: number;
  private now: () => number;
  private staleMs: number;

  constructor(
    options: {
      maxEntries?: number;
      now?: () => number;
      staleMs?: number;
    } = {}
  ) {
    this.maxEntries = Math.max(1, options.maxEntries ?? ENGAGEMENT_CACHE_LIMIT);
    this.now = options.now ?? Date.now;
    this.staleMs = options.staleMs ?? ENGAGEMENT_STALE_MS;
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

  // Re-inserts so Map iteration order stays least-recently-used first.
  private touch(key: string, entry: EngagementEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune();
  }

  // Publishes part of the payload's answer for a post, without claiming the
  // fields it does not know.
  //
  // Field ownership matters because a post is rendered by two independent
  // components that share one key: the vote cluster owns aura and userVote,
  // the bookmark toggle owns isBookmarkedByUser. A blanket overwrite would let
  // whichever mounted last reset the other's fields to its own defaults, so
  // each caller writes only what it actually resolved and the rest is
  // preserved.
  //
  // This is the no-network path: callers pass what the feed (or detail fetch)
  // already resolved for this viewer, and every surface showing the post
  // renders it immediately. A seeded entry counts as confirmed, so mounting a
  // card never triggers the read that would otherwise reconcile it.
  seed(key: string, value: Partial<PostEngagement>): void {
    const current = this.entries.get(key);
    const next: PostEngagement = {
      aura: value.aura ?? current?.aura ?? 0,
      isBookmarkedByUser:
        value.isBookmarkedByUser ?? current?.isBookmarkedByUser ?? false,
      userVote: value.userVote ?? current?.userVote ?? 0,
    };
    const unchanged = current !== undefined && sameEngagement(current, next);
    if (unchanged && current) {
      this.touch(key, current);
      return;
    }
    const snapshot: PostEngagement = Object.freeze({ ...next });
    this.touch(key, { ...next, confirmedAt: this.now(), snapshot });
    // An unchanged seed must not notify: the rendered value did not move, so
    // re-rendering every subscriber would be pure waste.
    this.notify();
  }

  // Seeds in bulk, notifying once instead of once per post. Each entry carries
  // only the fields its source resolved.
  seedMany(
    entries: Iterable<readonly [string, Partial<PostEngagement>]>
  ): void {
    let changed = false;
    for (const [key, value] of entries) {
      const current = this.entries.get(key);
      const next: PostEngagement = {
        aura: value.aura ?? current?.aura ?? 0,
        isBookmarkedByUser:
          value.isBookmarkedByUser ?? current?.isBookmarkedByUser ?? false,
        userVote: value.userVote ?? current?.userVote ?? 0,
      };
      const unchanged = current !== undefined && sameEngagement(current, next);
      if (unchanged && current) {
        this.touch(key, current);
        continue;
      }
      const snapshot: PostEngagement = Object.freeze({ ...next });
      this.touch(key, { ...next, confirmedAt: this.now(), snapshot });
      changed = true;
    }
    if (changed) {
      this.notify();
    }
  }

  // What a component should render: the stored value, or the fallback.
  read(key: string, fallback: Partial<PostEngagement>): PostEngagement {
    const entry = this.entries.get(key);
    if (!entry) {
      if (
        typeof fallback?.aura === "number" &&
        typeof fallback?.isBookmarkedByUser === "boolean" &&
        typeof fallback?.userVote === "number"
      ) {
        return fallback as PostEngagement;
      }
      return normalizeEngagement(fallback);
    }
    this.touch(key, entry);
    return entry.snapshot;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get size(): number {
    return this.entries.size;
  }

  isFresh(key: string): boolean {
    const entry = this.entries.get(key);
    return Boolean(entry && this.now() - entry.confirmedAt < this.staleMs);
  }

  // Writes a confirmed value. A mutation result goes through here, so every
  // surface showing the post updates at once and the entry stays fresh enough
  // that no follow-up read is needed.
  set(key: string, value: Partial<PostEngagement>): PostEngagement {
    const current = this.entries.get(key);
    const next: PostEngagement = {
      aura: value.aura ?? current?.aura ?? 0,
      isBookmarkedByUser:
        value.isBookmarkedByUser ?? current?.isBookmarkedByUser ?? false,
      userVote: value.userVote ?? current?.userVote ?? 0,
    };
    const unchanged = current !== undefined && sameEngagement(current, next);
    if (unchanged && current) {
      this.touch(key, current);
      return current.snapshot;
    }
    const snapshot: PostEngagement = Object.freeze({ ...next });
    this.touch(key, { ...next, confirmedAt: this.now(), snapshot });
    this.notify();
    return snapshot;
  }

  // Re-reads one post from the server: at most once per stale window, and at
  // most once concurrently. Callers passing the same key (a feed card and the
  // detail screen for one post) share the single request instead of racing.
  async refresh(
    key: string,
    options: ApiCallOptions
  ): Promise<PostEngagement | null> {
    const existing = this.inflight.get(key);
    if (existing) {
      await existing;
    } else {
      const run = (async () => {
        // The payload already answered this; only a stale entry earns a
        // request.
        if (this.isFresh(key)) {
          return;
        }
        const [vote, bookmark] = await Promise.all([
          fetchVoteInfo(key, options).catch(() => null),
          fetchBookmarkInfo(key, options).catch(() => null),
        ]);
        if (vote === null && bookmark === null) {
          // A failed read leaves the seeded value in place. The next attempt
          // waits for another stale window rather than firing per mount.
          return;
        }
        const current = this.entries.get(key);
        this.set(key, {
          aura: vote?.aura ?? current?.aura ?? 0,
          isBookmarkedByUser: bookmark ?? current?.isBookmarkedByUser ?? false,
          userVote: vote?.userVote ?? current?.userVote ?? 0,
        });
      })();
      this.inflight.set(key, run);
      try {
        await run;
      } finally {
        this.inflight.delete(key);
      }
    }
    const entry = this.entries.get(key);
    return entry ? entryValue(entry) : null;
  }

  // Drops everything. Called on sign-out and on an identity change, so one
  // viewer's votes are never rendered for the next one.
  clear(): void {
    if (this.entries.size === 0) {
      return;
    }
    this.entries.clear();
    this.notify();
  }
}

// Process-wide store, like feedCache and the unread-count store.
export const engagementStore = new EngagementStore();

function entryValue(entry: EngagementEntry): PostEngagement {
  return {
    aura: entry.aura,
    isBookmarkedByUser: entry.isBookmarkedByUser,
    userVote: entry.userVote,
  };
}
