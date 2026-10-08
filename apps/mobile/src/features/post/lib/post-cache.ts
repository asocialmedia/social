import type { FeedPost } from "@/features/feed/lib/feed-types";
import type { PersistSnapshot } from "@/lib/persistent-cache";
import { isFreshEntry } from "@/lib/persistent-cache";

import type { PostDetail } from "./post-api";

export function postDetailKey(
  postId: string,
  viewerId: string | undefined,
  apiBase: string
): string {
  return JSON.stringify([apiBase, viewerId ?? null, postId]);
}

// Details are account-scoped and revalidated on every open. A feed preview
// paints immediately while the complete ancestor chain loads in the background.
export class PostDetailCache {
  private entries = new Map<string, PostDetail>();
  private fetchedAt = new Map<string, number>();
  private invalidated = new Set<string>();

  private readonly now: () => number;
  private readonly onChange: () => void;
  constructor(now: () => number = Date.now, onChange: () => void = () => null) {
    this.now = now;
    this.onChange = onChange;
  }

  private inflight = new Map<string, Promise<PostDetail>>();

  read(key: string): PostDetail | undefined {
    if (
      this.now() - (this.fetchedAt.get(key) ?? 0) >
      POST_DETAIL_RETENTION_MS
    ) {
      this.entries.delete(key);
      this.fetchedAt.delete(key);
    }
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  private write(key: string, detail: PostDetail): void {
    this.entries.delete(key);
    this.entries.set(key, detail);
    this.fetchedAt.set(key, this.now());
    this.invalidated.delete(key);
    if (this.entries.size > 32) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
        this.fetchedAt.delete(oldest);
      }
    }
    this.onChange();
  }

  seed(key: string, post: FeedPost): void {
    if (!this.read(key)) {
      this.write(key, { ancestors: [], post });
    }
  }

  snapshot(): PersistSnapshot<PostDetail> {
    const entries: PersistSnapshot<PostDetail>["entries"] = {};
    for (const [key, detail] of this.entries) {
      const entry = { data: detail, fetchedAt: this.fetchedAt.get(key) ?? 0 };
      if (isFreshEntry(entry, this.now(), POST_DETAIL_RETENTION_MS)) {
        entries[key] = entry;
      }
    }
    return { entries, version: 1 };
  }

  restore(snapshot: PersistSnapshot<PostDetail>): void {
    for (const [key, entry] of Object.entries(snapshot.entries)) {
      if (this.entries.size >= 32) {
        break;
      }
      const detail = entry?.data;
      if (
        this.entries.has(key) ||
        this.invalidated.has(key) ||
        !isFreshEntry(entry, this.now(), POST_DETAIL_RETENTION_MS) ||
        !detail ||
        !Array.isArray(detail.ancestors) ||
        !validCachedPost(detail.post) ||
        !detail.ancestors.every(validCachedPost)
      ) {
        continue;
      }
      this.entries.set(key, detail);
      this.fetchedAt.set(key, entry.fetchedAt);
      if (this.entries.size >= 32) {
        break;
      }
    }
  }

  load(key: string, loader: () => Promise<PostDetail>): Promise<PostDetail> {
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const request = (async () => {
      // Publish the promise before even a synchronously throwing loader runs.
      await Promise.resolve();
      try {
        const detail = await loader();
        this.write(key, detail);
        this.inflight.delete(key);
        return detail;
      } catch (error) {
        this.inflight.delete(key);
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          (error.status === 404 || error.status === 401 || error.status === 403)
        ) {
          this.entries.delete(key);
          this.fetchedAt.delete(key);
          this.invalidated.add(key);
          this.onChange();
        }
        throw error;
      }
    })();
    this.inflight.set(key, request);
    return request;
  }
}

export const POST_DETAIL_RETENTION_MS = 30 * 60 * 1000;

function validCachedPost(post: FeedPost | null | undefined): boolean {
  return Boolean(
    post &&
    typeof post.id === "string" &&
    typeof post.userId === "string" &&
    typeof post.createdAt === "string"
  );
}

export const postDetailCache = new PostDetailCache(
  Date.now,
  schedulePostPersist
);
let hydration: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
export function hydratePostDetailCache(): Promise<void> {
  hydration ??= (async () => {
    try {
      const { readSnapshot } = await import("@/lib/persistent-file");
      postDetailCache.restore(
        await readSnapshot<PostDetail>("post-details-v1")
      );
    } catch {
      // A missing cache uses the normal post loading state.
    }
  })();
  return hydration;
}

function schedulePostPersist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void (async () => {
      try {
        await hydratePostDetailCache();
        const { writeSnapshot } = await import("@/lib/persistent-file");
        await writeSnapshot("post-details-v1", postDetailCache.snapshot());
      } catch {
        // Storage cannot interrupt navigation.
      }
    })();
  }, 150);
}
