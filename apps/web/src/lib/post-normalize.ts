import type { PostData } from "@asm/db";

// A post that escaped the server without the viewer-scoped `bookmarks` join
// (stale React Query page, persisted SSR prop, optimistic draft) will have
// `bookmarks === undefined` and crash any `post.bookmarks.some(...)` consumer.
// This module is the single normalization boundary for that shape.

export function isBookmarkedByUser(
  post: Pick<PostData, "bookmarks"> | undefined | null,
  userId: string | undefined | null
): boolean {
  if (!post || !userId) {
    return false;
  }
  const { bookmarks } = post as { bookmarks?: PostData["bookmarks"] };
  if (!Array.isArray(bookmarks)) {
    return false;
  }
  return bookmarks.some((bookmark) => bookmark.userId === userId);
}

export function normalizePostData<T extends PostData>(post: T): T {
  if (!post || typeof post !== "object") {
    return post;
  }
  let mutated = false;
  let next: T = post;

  const ensureArray = <K extends keyof T>(key: K, fallback: T[K]): void => {
    const value = (post as Record<string, unknown>)[key as string];
    if (!Array.isArray(value)) {
      if (!mutated) {
        next = { ...post } as T;
        mutated = true;
      }
      (next as Record<string, unknown>)[key as string] = fallback as unknown;
    }
  };

  ensureArray("bookmarks", [] as unknown as T[keyof T]);
  ensureArray("vote", [] as unknown as T[keyof T]);
  ensureArray("attachments", [] as unknown as T[keyof T]);
  ensureArray("tags", [] as unknown as T[keyof T]);
  ensureArray("mentions", [] as unknown as T[keyof T]);

  // _count is structurally required by the feed; patch a minimal shape so
  // stale serialized pages don't throw on `post._count.comments`.
  const count = (post as Record<string, unknown>)._count as
    | Record<string, unknown>
    | undefined;
  if (!count || typeof count !== "object") {
    if (!mutated) {
      next = { ...post } as T;
      mutated = true;
    }
    (next as Record<string, unknown>)._count = {
      comments: 0,
      mentions: 0,
      vote: 0,
    };
  }

  return next;
}

export function normalizePostsData<T extends PostData>(posts: T[]): T[] {
  let changed = false;
  const next = posts.map((post) => {
    const normalized = normalizePostData(post);
    if (normalized !== post) {
      changed = true;
    }
    return normalized;
  });
  return changed ? next : posts;
}

export function isStalePost(record: Record<string, unknown>): boolean {
  // Any PostData-like object that carries `content` + `id` but is missing the
  // bookmarks array is from a stale cache that predates the viewer join or was
  // manually constructed optimistically.
  if (typeof record.id !== "string" || typeof record.content !== "string") {
    return false;
  }
  // Heuristic: posts always have `aura` and `userId`. If those exist but
  // bookmarks is not an array, the record is stale.
  if (typeof record.aura !== "number" || typeof record.userId !== "string") {
    return false;
  }
  return !Array.isArray(record.bookmarks);
}
