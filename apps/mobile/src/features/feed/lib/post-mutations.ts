// Post overflow mutations: delete, moderation and edit tags.
//
// These three used to be unreachable from native because web drove them through
// Next server actions. They now go through the REST routes the web app exposes
// (DELETE /api/posts/:id, PATCH /api/posts/:id and POST .../tags), so the
// native menu can offer the same entries web does instead of omitting them
// and leaving a dead menu.
//
// Share to feed is deliberately absent: it is not a mutation here. Web opens
// the composer pre-filled with the source post, and the publish carries
// communitySharePostId. Note that POST .../share is NOT that feature - it is
// the per-platform share counter, which wants a `platform` body and returns no
// post id.
//
// Every call runs through runWithInstallToken, because these are the mutations
// most likely to trip the server's bot gate: a burst of moderation taps from a
// fresh install is exactly the shape that gets challenged.

// Every call takes an injected log sink. The transport is pure on purpose:
// importing the real logger or the auth client would pull react-native in
// through the OTel exporter, which Bun cannot parse, so neither the requests
// nor the retry policy would be testable. Omitting the sink is silent rather
// than a crash, and the retry policy keeps working without one.

import { HttpError, withRetry } from "@/features/media-upload/lib/retry";
import { withAuthHeaders } from "@/lib/auth-headers";

import type { ApiCallOptions } from "./feed-api";
import type { FeedPost } from "./feed-types";

export type MutationLogAttributes = Record<string, boolean | number | string>;

export interface MutationLog {
  info: (message: string, attributes?: MutationLogAttributes) => void;
  warn: (message: string, attributes?: MutationLogAttributes) => void;
}

// A no-op sink: omitting the log must not crash a mutation, so the default
// has to accept a call and discard it. A comment is a body as far as the
// no-empty-function rule is concerned.
const SILENT_LOG: MutationLog = {
  info: () => {
    // discarded
  },
  warn: () => {
    // discarded
  },
};

export type PostModerationChange = "explicitContent" | "moderated";

/** Web's PostModerationChanges, as the route accepts it. */
export interface PostModerationChanges {
  explicitContent?: boolean;
  moderated?: boolean;
}

export interface PostModerationResult {
  explicitContent?: boolean | null;
  id: string;
  moderated?: boolean | null;
}

async function postJson<T>(
  path: string,
  init: RequestInit,
  options: ApiCallOptions
): Promise<T> {
  const response = await (options.baseFetch ?? fetch)(
    `${options.apiBase.replace(/\/+$/, "")}${path}`,
    {
      ...init,
      headers: withAuthHeaders(
        {
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string>),
        },
        options.cookie
      ),
    }
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    // HttpError keeps withRetry from spending an attempt on a 4xx, which will
    // not become a 200 on a retry.
    throw new HttpError(
      payload?.error ?? `Request failed with ${response.status}`,
      response.status
    );
  }
  return (await response.json()) as T;
}

function postPath(postId: string, suffix = ""): string {
  return `/api/posts/${encodeURIComponent(postId)}${suffix}`;
}

export async function deletePost(
  postId: string,
  options: ApiCallOptions,
  log: MutationLog = SILENT_LOG
): Promise<void> {
  await withRetry(
    async () => {
      await postJson<unknown>(postPath(postId), { method: "DELETE" }, options);
      log.info("post.deleted", { postId });
    },
    {
      attempts: 3,
      baseMs: 500,
      onRetry: (error, attempt, delayMs) =>
        log.warn("post.delete_retry", {
          attempt,
          delayMs,
          postId,
          status: error instanceof HttpError ? error.status : 0,
        }),
    }
  );
}

export async function updatePostModeration(
  postId: string,
  changes: PostModerationChanges,
  options: ApiCallOptions,
  log: MutationLog = SILENT_LOG
): Promise<PostModerationResult> {
  const result = await withRetry(
    async () =>
      await postJson<{ post: PostModerationResult }>(
        postPath(postId),
        { body: JSON.stringify(changes), method: "PATCH" },
        options
      ),
    {
      attempts: 3,
      baseMs: 500,
      onRetry: (error, attempt, delayMs) =>
        log.warn("post.moderation_retry", {
          attempt,
          delayMs,
          postId,
          status: error instanceof HttpError ? error.status : 0,
        }),
    }
  );
  log.info("post.moderated", { ...changes, postId });
  return result.post;
}

export async function updatePostTags(
  postId: string,
  tags: readonly string[],
  options: ApiCallOptions,
  log: MutationLog = SILENT_LOG
): Promise<void> {
  await withRetry(
    async () => {
      await postJson<unknown>(
        postPath(postId, "/tags"),
        { body: JSON.stringify({ tags: [...tags] }), method: "POST" },
        options
      );
      log.info("post.tags_updated", { count: tags.length, postId });
    },
    {
      attempts: 3,
      baseMs: 500,
      onRetry: (error, attempt, delayMs) =>
        log.warn("post.tags_retry", {
          attempt,
          delayMs,
          postId,
          status: error instanceof HttpError ? error.status : 0,
        }),
    }
  );
}

/** Web's canModeratePost, for deciding whether the entry is offered at all. */
export function canModeratePost(
  post: FeedPost,
  viewer: { id?: string | null; role?: string | null } | null | undefined
): boolean {
  if (!viewer?.id) {
    return false;
  }
  if (post.user?.id === viewer.id) {
    return true;
  }
  return viewer.role === "admin" || viewer.role === "moderator";
}
