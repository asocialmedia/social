import { ProtocolError } from "@asm/protocols/contracts";
import { UnrecoverableError } from "bullmq";

export const hydrationLifetimeMs = 5 * 60_000;

// A re-fenced batch may keep deferring through a long outage. Bound the total
// time a batch can spend being re-fenced so persistently failing work is
// eventually released instead of occupying the bounded queue forever.
export const maxRefenceAgeMs = 60 * 60_000;

// A batch that waited out its invalidation fence. Unlike invalid batches,
// which are poison, an expired batch is still wanted: callers re-fence it
// with a current timestamp and defer it so the posts hydrate instead of
// dropping.
export class HydrationLifetimeExpiredError extends UnrecoverableError {
  constructor() {
    super("Protocol hydration lifetime expired");
    this.name = "HydrationLifetimeExpiredError";
  }
}

export interface RefenceDecision {
  // Set when the batch may be re-fenced and deferred again.
  refencedAt: number;
  // Set when the batch has been re-fenced for too long and must be dropped.
  terminal: boolean;
}

// Bounds the re-fence loop: repeated deferrals keep the original fence
// timestamp, so a job that can never hydrate is eventually released instead
// of occupying the bounded queue forever.
export function resolveRefence(
  refencedAt: number | undefined,
  now: number
): RefenceDecision {
  const first = refencedAt ?? now;
  if (now - first > maxRefenceAgeMs) {
    return { refencedAt: first, terminal: true };
  }
  return { refencedAt: first, terminal: false };
}

export function hydrationRetryDelay(error: unknown): number | undefined {
  if (
    error instanceof ProtocolError &&
    ["capacity", "unavailable", "rate_limited"].includes(error.code) &&
    error.retryAfterSeconds &&
    Number.isFinite(error.retryAfterSeconds) &&
    error.retryAfterSeconds > 0
  ) {
    return Math.min(60_000, Math.max(1000, error.retryAfterSeconds * 1000));
  }
}
