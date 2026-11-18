import { ProtocolError } from "@asm/protocols/contracts";
import { UnrecoverableError } from "bullmq";

export const hydrationLifetimeMs = 5 * 60_000;

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
