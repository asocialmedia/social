import type { PostData } from "@asm/db";

// A post that escaped the server without viewer-scoped joins or array relations
// (stale React Query page, persisted SSR prop, optimistic draft, route cache) will
// have undefined properties and crash consumers like `post.vote[0]`, `post.attachments.length`,
// or `post.bookmarks.some(...)`. This module is the single normalization boundary.

export function isBookmarkedByUser(
  post: { bookmarks?: { userId?: string }[] | null } | undefined | null,
  userId: string | undefined | null
): boolean {
  if (!post || !userId) {
    return false;
  }
  const { bookmarks } = post;
  if (!Array.isArray(bookmarks)) {
    return false;
  }
  return bookmarks.some((bookmark) => bookmark?.userId === userId);
}

export function getUserVote(
  post:
    | { vote?: { userId?: string; value?: number }[] | null }
    | undefined
    | null
): number {
  if (!post || !Array.isArray(post.vote) || post.vote.length === 0) {
    return 0;
  }
  return post.vote[0]?.value ?? 0;
}

export function getCommentVote(
  comment:
    | { votes?: { userId?: string; value?: number }[] | null }
    | undefined
    | null
): number {
  if (!comment || !Array.isArray(comment.votes) || comment.votes.length === 0) {
    return 0;
  }
  return comment.votes[0]?.value ?? 0;
}

export function getPostAttachments<M = unknown>(
  post: { attachments?: M[] | null } | undefined | null
): M[] {
  if (!post || !Array.isArray(post.attachments)) {
    return [];
  }
  return post.attachments;
}

export function normalizePostData<T extends PostData>(post: T): T {
  if (!post || typeof post !== "object") {
    return post;
  }

  // If a response wrapper like `{ post: { ... } }` was mistakenly passed, unwrap it.
  const rawPost = (
    "post" in post &&
    post.post &&
    typeof post.post === "object" &&
    "id" in (post.post as Record<string, unknown>)
      ? (post.post as T)
      : post
  ) as T;

  let mutated = false;
  let next: T = rawPost;

  const ensureArray = <K extends keyof T>(key: K, fallback: T[K]): void => {
    const value = (rawPost as Record<string, unknown>)[key as string];
    if (!Array.isArray(value)) {
      if (!mutated) {
        next = { ...rawPost } as T;
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
  const count = (rawPost as Record<string, unknown>)._count as
    | Record<string, unknown>
    | undefined;
  if (!count || typeof count !== "object" || Array.isArray(count)) {
    if (!mutated) {
      next = { ...rawPost } as T;
      mutated = true;
    }
    (next as Record<string, unknown>)._count = {
      comments: 0,
      mentions: 0,
      vote: 0,
    };
  } else {
    const comments = typeof count.comments === "number" ? count.comments : 0;
    const mentions = typeof count.mentions === "number" ? count.mentions : 0;
    const vote = typeof count.vote === "number" ? count.vote : 0;
    if (
      count.comments !== comments ||
      count.mentions !== mentions ||
      count.vote !== vote
    ) {
      if (!mutated) {
        next = { ...rawPost } as T;
        mutated = true;
      }
      (next as Record<string, unknown>)._count = {
        ...count,
        comments,
        mentions,
        vote,
      };
    }
  }

  return next;
}

export function normalizePostsData<T extends PostData>(posts: T[]): T[] {
  if (!Array.isArray(posts)) {
    return [];
  }
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
  if (typeof record.id !== "string" || typeof record.content !== "string") {
    return false;
  }
  if (typeof record.aura !== "number" || typeof record.userId !== "string") {
    return false;
  }
  return (
    !Array.isArray(record.bookmarks) ||
    !Array.isArray(record.vote) ||
    !Array.isArray(record.attachments) ||
    !Array.isArray(record.tags) ||
    !Array.isArray(record.mentions) ||
    !record._count ||
    typeof record._count !== "object" ||
    Array.isArray(record._count) ||
    typeof (record._count as Record<string, unknown>).comments !== "number" ||
    typeof (record._count as Record<string, unknown>).mentions !== "number" ||
    typeof (record._count as Record<string, unknown>).vote !== "number"
  );
}
