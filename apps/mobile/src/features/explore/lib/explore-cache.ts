import type { FeedPost } from "@/features/feed/lib/feed-types";
import { emptySnapshot, pruneSnapshot } from "@/lib/cache/persistent-cache";
import type { PersistSnapshot } from "@/lib/cache/persistent-cache";

import type { ExploreFollowResult, ExplorePage } from "./explore-api";

export const EXPLORE_RETENTION_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 16;

export interface ExploreData extends ExplorePage {
  gusts: FeedPost[];
}

export interface ExploreResource {
  data: ExploreData | null;
  error: string | null;
  fetchedAt: number;
  pending: "initial" | "refresh" | "append" | null;
}

const EMPTY: ExploreResource = {
  data: null,
  error: null,
  fetchedAt: 0,
  pending: null,
};

export function exploreCacheKey(
  apiBase: string,
  viewerId: string | undefined,
  tab: string,
  search: string
): string {
  return JSON.stringify([apiBase, viewerId ?? "guest", tab, search.trim()]);
}

function mergeUnique<T extends { id: string }>(current: T[], next: T[]): T[] {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !known.has(item.id))];
}

// A tab visit reuses the complete page chain; only refresh or expiry reloads it.
export class ExploreCache {
  private entries = new Map<string, ExploreResource>();
  private requests = new Map<string, Promise<void>>();
  private offsets = new Map<string, number>();
  private listeners = new Set<() => void>();
  private generation = 0;

  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  read = (key: string): ExploreResource => this.entries.get(key) ?? EMPTY;

  private write(key: string, resource: ExploreResource): void {
    this.entries.delete(key);
    this.entries.set(key, resource);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
      this.offsets.delete(oldest);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  isFresh(key: string): boolean {
    const resource = this.read(key);
    return (
      resource.data !== null &&
      this.now() - resource.fetchedAt < EXPLORE_RETENTION_MS
    );
  }

  load(
    key: string,
    fetchData: () => Promise<ExploreData> | ExploreData,
    mode: "initial" | "refresh" | "append" = "initial",
    cursor?: string
  ): Promise<void> {
    const pending = this.requests.get(key);
    if (pending) {
      return pending;
    }
    if (mode === "initial" && this.isFresh(key)) {
      return Promise.resolve();
    }
    const current = this.read(key);
    if (mode === "append" && (!cursor || current.data?.nextCursor !== cursor)) {
      return Promise.resolve();
    }
    const { generation } = this;
    this.write(key, { ...current, error: null, pending: mode });
    const request = (async () => {
      try {
        await Promise.resolve();
        const data = await fetchData();
        if (generation !== this.generation) {
          return;
        }
        const previous = this.read(key);
        const merged =
          mode === "append" && previous.data
            ? {
                ...previous.data,
                nextCursor: data.nextCursor === cursor ? null : data.nextCursor,
                posts: mergeUnique(previous.data.posts, data.posts),
                users: mergeUnique(previous.data.users, data.users),
              }
            : data;
        this.write(key, {
          data: merged,
          error: null,
          fetchedAt: mode === "append" ? previous.fetchedAt : this.now(),
          pending: null,
        });
      } catch (error) {
        if (generation !== this.generation) {
          return;
        }
        this.write(key, {
          ...this.read(key),
          error:
            error instanceof Error ? error.message : "Could not load Explore",
          pending: null,
        });
      } finally {
        if (generation === this.generation) {
          this.requests.delete(key);
        }
      }
    })();
    this.requests.set(key, request);
    return request;
  }

  updateFollow(
    apiBase: string,
    viewerId: string,
    userId: string,
    result: ExploreFollowResult
  ): void {
    // Writes promote entries, so iterate a snapshot of the map.
    const entries = [...this.entries];
    for (const [key, entry] of entries) {
      const scope: unknown = JSON.parse(key);
      if (
        !Array.isArray(scope) ||
        scope[0] !== apiBase ||
        scope[1] !== viewerId ||
        !entry.data
      ) {
        continue;
      }
      this.write(key, {
        ...entry,
        data: {
          ...entry.data,
          users: entry.data.users.map((user) =>
            user.id === userId
              ? {
                  ...user,
                  _count: { ...user._count, followers: result.followers },
                  isFollowing: result.isFollowedByUser,
                }
              : user
          ),
        },
      });
    }
  }

  prepend(key: string, posts: FeedPost[]): void {
    const entry = this.read(key);
    if (entry.data) {
      this.write(key, {
        ...entry,
        data: { ...entry.data, posts: mergeUnique(posts, entry.data.posts) },
      });
    }
  }

  scrollOffset(key: string): number {
    return this.offsets.get(key) ?? 0;
  }

  setScrollOffset(key: string, offset: number): void {
    this.offsets.set(key, Math.max(0, offset));
  }

  hydrate(snapshot: PersistSnapshot<ExploreData>): void {
    const fresh = pruneSnapshot(
      snapshot,
      this.now(),
      EXPLORE_RETENTION_MS,
      MAX_ENTRIES
    );
    for (const [key, entry] of Object.entries(fresh.entries)) {
      if (this.entries.has(key)) {
        continue;
      }
      const { data } = entry;
      if (
        !data ||
        !Array.isArray(data.posts) ||
        !Array.isArray(data.users) ||
        !Array.isArray(data.gusts) ||
        !Array.isArray(data.communities)
      ) {
        continue;
      }
      this.write(key, {
        data,
        error: null,
        fetchedAt: entry.fetchedAt,
        pending: null,
      });
    }
  }

  snapshot(): PersistSnapshot<ExploreData> {
    const snapshot = emptySnapshot<ExploreData>();
    for (const [key, entry] of this.entries) {
      if (entry.data) {
        snapshot.entries[key] = {
          data: entry.data,
          fetchedAt: entry.fetchedAt,
        };
      }
    }
    return pruneSnapshot(
      snapshot,
      this.now(),
      EXPLORE_RETENTION_MS,
      MAX_ENTRIES
    );
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.requests.clear();
    this.offsets.clear();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const exploreCache = new ExploreCache();
