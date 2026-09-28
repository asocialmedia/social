// A "take me to the top of this feed" command, shared between whatever moves
// the reader there and the surfaces that own a feed's scroll position.
//
// It is a one-shot module signal rather than state because it is an instruction,
// not something a component renders: the surface that owns the named feed
// claims it, and only that one. The subscription is the part that matters -
// without it a request aimed at the feed already on screen would never be
// observed, because nothing about the request changes that surface's props.
let pendingKey: string | null = null;
const listeners = new Set<() => void>();

/** Asks the named feed (e.g. `home:latest`) to go to the top. */
export function requestFeedTop(key: string): void {
  pendingKey = key;
  for (const listener of listeners) {
    listener();
  }
}

/** Claims a pending request for `key`; true at most once per request. */
export function consumeFeedTop(key: string): boolean {
  if (pendingKey !== key) {
    return false;
  }
  pendingKey = null;
  return true;
}

/** Notified whenever a request is made, so a visible surface can react. */
export function subscribeFeedTopRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drops an unclaimed request so it cannot hijack a later visit. */
export function clearFeedTopRequest(): void {
  pendingKey = null;
}
