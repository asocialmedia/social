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

// Asks a feed or its visible scoped variant to go to the top.
export function requestFeedTop(key: string): void {
  pendingKey = key;
  for (const listener of listeners) {
    listener();
  }
}

// Claims a pending request for this feed or its parent scope exactly once.
export function consumeFeedTop(key: string): boolean {
  if (
    !pendingKey ||
    (pendingKey !== key && !key.startsWith(`${pendingKey}:`))
  ) {
    return false;
  }
  pendingKey = null;
  return true;
}

// Notifies visible surfaces whenever a top request arrives.
export function subscribeFeedTopRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Drops an unclaimed request so it cannot hijack a later visit.
export function clearFeedTopRequest(): void {
  pendingKey = null;
}
