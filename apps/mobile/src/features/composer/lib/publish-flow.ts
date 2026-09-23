// The publish decision flow for POST /api/posts, kept free of native imports
// so it is unit-tested:
// - transient failures (network, 408, 429, 5xx) retry with backoff, reusing
//   the same Idempotency-Key, so a retry can never publish twice
// - 409 { error: "duplicate", postId } means an earlier attempt landed: done
// - 409 { error: "in-flight" } means the first attempt is still running:
//   wait and ask again (bounded), without spending the retry budget
// - anything else surfaces to the composer
import { HttpError, withRetry } from "@/features/media-upload/lib/retry";

export type PublishOutcome<T> =
  | { kind: "created"; post: T }
  | { kind: "duplicate"; postId: string };

export function duplicatePostId(error: unknown): string | null {
  if (!(error instanceof HttpError) || error.status !== 409) {
    return null;
  }
  const body = error.body as { error?: unknown; postId?: unknown } | null;
  return body?.error === "duplicate" && typeof body.postId === "string"
    ? body.postId
    : null;
}

export function isInFlightConflict(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 409) {
    return false;
  }
  const body = error.body as { error?: unknown } | null;
  return body?.error === "in-flight";
}

export interface PublishFlowOptions {
  attempts?: number;
  inFlightWaitMs?: number;
  maxInFlightWaits?: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  retryBaseMs?: number;
  signal?: AbortSignal;
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function runPublishFlow<T>(
  send: () => Promise<T>,
  options: PublishFlowOptions
): Promise<PublishOutcome<T>> {
  const maxWaits = options.maxInFlightWaits ?? 10;
  for (let inFlightWaits = 0; ; inFlightWaits += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design: wait out an in-flight twin before retrying
      const post = await withRetry(send, {
        attempts: options.attempts ?? 4,
        baseMs: options.retryBaseMs,
        onRetry: options.onRetry,
        signal: options.signal,
      });
      return { kind: "created", post };
    } catch (error) {
      const duplicate = duplicatePostId(error);
      if (duplicate) {
        return { kind: "duplicate", postId: duplicate };
      }
      if (isInFlightConflict(error) && inFlightWaits < maxWaits) {
        // eslint-disable-next-line no-await-in-loop -- the twin needs time to finish before we ask again
        await options.wait(options.inFlightWaitMs ?? 2000, options.signal);
        continue;
      }
      throw error;
    }
  }
}
