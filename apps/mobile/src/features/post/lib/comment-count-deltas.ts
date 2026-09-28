// Comment and response count deltas, applied live from a post's SSE stream.
//
// Web keeps its posts in a query cache and nudges `_count.comments` in place
// as events arrive, so the header count moves the moment an eddie lands rather
// than on the next refetch. Mobile has no shared query cache, so the deltas
// live in this small module-level store instead and are read wherever a count
// is rendered.
//
// Deltas are stored as a sum per post rather than mutating posts, because the
// same post can be on screen in several places at once (feed card, detail
// card, media screen) and each holds its own copy of the object.

interface CountKey {
  field: "comments" | "responses";
  postId: string;
}

const deltas = new Map<string, number>();
const listeners = new Set<() => void>();

function keyOf({ field, postId }: CountKey): string {
  return `${field}:${postId}`;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Records a stream event against a post. Negative deltas are clamped at zero
 * so a delete that races the initial fetch cannot render "-1 comments".
 */
export function applyCountDelta(key: CountKey, delta: number): void {
  const id = keyOf(key);
  deltas.set(id, (deltas.get(id) ?? 0) + delta);
  notify();
}

/** The live delta for a post's count, or 0 when nothing has arrived. */
export function getCountDelta(key: CountKey): number {
  return deltas.get(keyOf(key)) ?? 0;
}

/** A post's count including any live deltas, never below zero. */
export function withCountDelta(
  postId: string,
  field: "comments" | "responses",
  base: number
): number {
  return Math.max(0, base + getCountDelta({ field, postId }));
}

/** Drops a post's deltas, for when its post is re-read from the server. */
export function clearCountDeltas(key: CountKey): void {
  deltas.delete(keyOf(key));
  notify();
}

/** Subscribes to delta changes; returns the unsubscribe function. */
export function subscribeCountDeltas(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
