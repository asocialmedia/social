// The asocialmedia discussion on a Bluesky post, shaped for the eddie rows.
// Shared by the external post page and the in-reel gust eddies sheet.
import type { ExternalComment } from "@asm/protocols/discovery";

import type { FeedComment } from "./feed-api";

// Matches the page's existing cap so a long discussion cannot grow unbounded.
export const EXTERNAL_COMMENT_LIMIT = 600;

export function externalCommentsToFeed(
  comments: readonly ExternalComment[]
): FeedComment[] {
  return comments.map((comment) => ({
    content: comment.content,
    createdAt: comment.createdAt,
    deleted: comment.deleted,
    id: comment.id,
    parentId: comment.parentId ?? null,
    source: comment.source,
    user: {
      avatarUrl: comment.user?.avatarUrl ?? null,
      displayName: comment.user.displayName,
      id: comment.user.id,
      username: comment.user.username,
    },
  }));
}

// Appends a later page, deduping by id like web's ExternalDiscussion Map,
// keeping the first position and taking the newer copy of a repeated comment.
export function mergeExternalComments(
  current: readonly ExternalComment[],
  next: readonly ExternalComment[]
): ExternalComment[] {
  const byId = new Map<string, ExternalComment>();
  for (const comment of [...current, ...next]) {
    byId.set(comment.id, comment);
  }
  return [...byId.values()].slice(-EXTERNAL_COMMENT_LIMIT);
}
