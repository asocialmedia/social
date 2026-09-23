// Idempotency for the REST post-create route. Native clients retry a create
// after a dropped connection; without a key the retry would publish the post
// twice. The client sends one `Idempotency-Key` per composed post and reuses
// it on every retry of that post.
//
// Lifecycle in Redis (per user, 10 minutes):
//   claim   -> SET NX "pending"      first request owns the key
//   success -> SET "<postId>"        later retries learn the post exists
//   failure -> DEL                   the next retry may try again

export const IDEMPOTENCY_TTL_SECONDS = 600;
export const IDEMPOTENCY_PENDING = "pending";

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// A missing header is allowed (web never sends one); a malformed one is not,
// so a buggy client fails loudly instead of silently losing protection.
export function parseIdempotencyKey(
  header: string | null
): { key: string | null; ok: true } | { ok: false } {
  if (header === null || header === "") {
    return { key: null, ok: true };
  }
  return KEY_PATTERN.test(header) ? { key: header, ok: true } : { ok: false };
}

export function idempotencyRedisKey(userId: string, key: string): string {
  return `post-idem:${userId}:${key}`;
}
