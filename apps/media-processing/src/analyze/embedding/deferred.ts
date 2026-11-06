export class EmbeddingDeferredError extends Error {
  readonly retryAt: number;
  readonly reason:
    | "credentials"
    | "provider"
    | "invalid-vector"
    | "unavailable";
  constructor(reason: EmbeddingDeferredError["reason"], retryAt: number) {
    super(`Embedding deferred: ${reason}`);
    this.name = "EmbeddingDeferredError";
    this.reason = reason;
    this.retryAt = retryAt;
  }
}

export function embeddingRetryAt(
  status: number,
  retryAfter: string | null,
  now = Date.now()
): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const requested = Number.isFinite(seconds)
    ? now + seconds * 1000
    : Date.parse(retryAfter ?? "");
  let fallback = 60_000;
  if (status === 429) {
    fallback = 15 * 60_000;
  } else if (status >= 400 && status < 500 && status !== 408) {
    fallback = 6 * 60 * 60_000;
  }
  return (
    now +
    Math.min(
      24 * 60 * 60_000,
      Math.max(60_000, Number.isFinite(requested) ? requested - now : fallback)
    )
  );
}
