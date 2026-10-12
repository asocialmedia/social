import type { FeedPost } from "@/features/feed/lib/feed-types";

export interface CommunityFeedPage {
  posts: FeedPost[];
  nextCursor: string | null;
}
const FRESH_MS = 30 * 60 * 1000;
export class CommunityPageCache {
  readonly entries = new Map<
    string,
    { page: CommunityFeedPage; savedAt: number }
  >();
  readonly pending = new Map<string, Promise<CommunityFeedPage>>();
  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    return entry && now - entry.savedAt < FRESH_MS ? entry.page : null;
  }
  load(
    key: string,
    loader: () => Promise<CommunityFeedPage>,
    refresh = false
  ): Promise<CommunityFeedPage> {
    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }
    const cached = refresh ? null : this.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }
    const request = (async () => {
      await Promise.resolve();
      try {
        const page = await loader();
        this.entries.set(key, { page, savedAt: Date.now() });
        if (this.entries.size > 32) {
          const oldest = this.entries.keys().next().value;
          if (oldest) {
            this.entries.delete(oldest);
          }
        }
        return page;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, request);
    return request;
  }
  removePost(id: string) {
    for (const entry of this.entries.values()) {
      entry.page = {
        ...entry.page,
        posts: entry.page.posts.filter((post) => post.id !== id),
      };
    }
  }
  append(key: string, page: CommunityFeedPage) {
    const existing = this.get(key)?.posts ?? [];
    const seen = new Set(existing.map((post) => post.id));
    const next = {
      nextCursor: page.nextCursor,
      posts: [
        ...existing,
        ...page.posts.filter((post) => {
          if (seen.has(post.id)) {
            return false;
          }
          seen.add(post.id);
          return true;
        }),
      ],
    };
    this.entries.set(key, { page: next, savedAt: Date.now() });
    return next;
  }
}
export const communityPageCache = new CommunityPageCache();
export function communityMediaUrl(
  value: string | null,
  apiBase: string
): string | null {
  if (!value) {
    return null;
  }
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  return value.startsWith("/") && !value.startsWith("//")
    ? `${apiBase.replace(/\/+$/, "")}${value}`
    : null;
}
