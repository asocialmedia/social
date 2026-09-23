// Publishing for the native composers: posts and responses through the REST
// POST /api/posts (which runs web's submitPost), eddies through
// POST /api/posts/:id/comments, eddie deletion through
// DELETE /api/comments/:id.
//
// Posts carry an Idempotency-Key per composed post, so retries after a
// dropped connection can never publish twice: a retry of a create that
// already landed answers 409 duplicate and resolves to that post. Eddie
// creation has no server-side key, so it only auto-retries a 429 (rejected
// before anything was written); any other failure keeps the draft for a
// manual resend instead of risking a double eddie.
import { randomUUID } from "expo-crypto";

import type { FeedComment } from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { HttpError, sleep, withRetry } from "@/features/media-upload/lib/retry";
import { apiJson } from "@/features/media-upload/lib/upload-api";
import { logError, logInfo, logWarn } from "@/lib/telemetry";

export interface CreatePostPayload {
  communityId?: string;
  content: string;
  dismissedEmbedUrls?: string[];
  isGust?: boolean;
  mediaIds: string[];
  mentions: string[];
  parentPostId?: string;
  tags: string[];
}

export type PublishResult =
  | { kind: "created"; post: FeedPost }
  | { kind: "duplicate"; postId: string };

export function newIdempotencyKey(): string {
  return randomUUID();
}

function duplicateOf(error: unknown): string | null {
  if (!(error instanceof HttpError) || error.status !== 409) {
    return null;
  }
  const body = error.body as { error?: unknown; postId?: unknown } | null;
  return body?.error === "duplicate" && typeof body.postId === "string"
    ? body.postId
    : null;
}

function isInFlight(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 409) {
    return false;
  }
  const body = error.body as { error?: unknown } | null;
  return body?.error === "in-flight";
}

export async function publishPost(
  payload: CreatePostPayload,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<PublishResult> {
  const startedAt = Date.now();
  // In-flight answers mean the first attempt is still being processed:
  // wait for it rather than counting it against the retry budget.
  for (let inFlightWaits = 0; ; inFlightWaits += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design: wait out an in-flight twin before retrying
      const post = await withRetry(
        () =>
          apiJson<FeedPost>("/api/posts", {
            body: payload,
            headers: { "idempotency-key": idempotencyKey },
            method: "POST",
            signal,
          }),
        {
          attempts: 4,
          onRetry: (error, attempt, delayMs) =>
            logWarn("publish.retry", {
              attempt,
              delayMs,
              status: error instanceof HttpError ? error.status : 0,
            }),
          signal,
        }
      );
      logInfo("publish.done", {
        attachments: payload.mediaIds.length,
        ms: Date.now() - startedAt,
        response: Boolean(payload.parentPostId),
      });
      return { kind: "created", post };
    } catch (error) {
      const duplicate = duplicateOf(error);
      if (duplicate) {
        logInfo("publish.deduplicated", {});
        return { kind: "duplicate", postId: duplicate };
      }
      if (isInFlight(error) && inFlightWaits < 10) {
        // eslint-disable-next-line no-await-in-loop -- the twin needs time to finish before we ask again
        await sleep(2000, signal);
        continue;
      }
      logError("publish.failed", error, {
        status: error instanceof HttpError ? error.status : 0,
      });
      throw error;
    }
  }
}

export async function createEddie(
  postId: string,
  input: { content: string; mediaIds?: string[]; parentId?: string },
  signal?: AbortSignal
): Promise<FeedComment> {
  const path = `/api/posts/${encodeURIComponent(postId)}/comments`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- only a rate-limited attempt is retried, one at a time
      const comment = await apiJson<FeedComment>(path, {
        body: {
          content: input.content,
          ...(input.mediaIds && input.mediaIds.length > 0
            ? { mediaIds: input.mediaIds }
            : {}),
          ...(input.parentId ? { parentId: input.parentId } : {}),
        },
        method: "POST",
        signal,
      });
      logInfo("eddie.created", {
        attachments: input.mediaIds?.length ?? 0,
        reply: Boolean(input.parentId),
      });
      return comment;
    } catch (error) {
      if (error instanceof HttpError && error.status === 429 && attempt < 3) {
        // eslint-disable-next-line no-await-in-loop -- honor the server's retry-after before the next attempt
        await sleep(error.retryAfterMs ?? 2000 * attempt, signal);
        continue;
      }
      logError("eddie.create_failed", error, {
        status: error instanceof HttpError ? error.status : 0,
      });
      throw error;
    }
  }
}

// Deleting is idempotent server-side (an already-deleted eddie answers
// success), so it retries freely.
export async function deleteEddie(commentId: string): Promise<void> {
  await withRetry(
    () =>
      apiJson(`/api/comments/${encodeURIComponent(commentId)}`, {
        method: "DELETE",
      }),
    { attempts: 3 }
  );
  logInfo("eddie.deleted", {});
}
