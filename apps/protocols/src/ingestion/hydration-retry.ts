import { ProtocolError } from "@asm/protocols/contracts";

export const hydrationLifetimeMs = 5 * 60_000;

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
