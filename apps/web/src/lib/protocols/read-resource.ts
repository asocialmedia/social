// Retry transient public reads within a bounded window; invalid and unavailable records keep their own outcomes.
// oxlint-disable no-await-in-loop
import {
  abortable,
  canRetryRead,
  FeedReadError,
  readJsonBounded,
  retryAfterMs,
  waitForReadRetry,
} from "@asm/protocols/discovery";

export async function readProtocolResource(
  url: string,
  signal: AbortSignal,
  options: {
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    wait?: typeof waitForReadRetry;
    timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const budget = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    budget.throwIfAborted();
    const bounded = AbortSignal.any([
      budget,
      AbortSignal.timeout(options.timeoutMs ?? 12_000),
    ]);
    try {
      const response = await abortable(
        (options.fetch ?? fetch)(url, { cache: "no-store", signal: bounded }),
        bounded
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new FeedReadError(
          response.status,
          retryAfterMs(response.headers.get("retry-after")) ?? 1000
        );
      }
      return await readJsonBounded(response, 2 * 1024 * 1024, bounded);
    } catch (error) {
      budget.throwIfAborted();
      const failure = bounded.aborted ? new FeedReadError(408) : error;
      const delay =
        failure instanceof FeedReadError ? failure.retryAfter : 1000;
      if (attempt === 2 || !canRetryRead(failure) || delay > 5000) {
        throw failure;
      }
      await (options.wait ?? waitForReadRetry)(
        Math.max(delay, 500 * 2 ** attempt),
        budget
      );
    }
  }
  throw new FeedReadError(504);
}
