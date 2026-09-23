// Per-post "eddie created" bus: a composer that lives outside the thread
// (the floating bottom bar) announces the eddie the server returned, and the
// thread for that post merges it in at once instead of refetching.
import type { FeedComment } from "@/features/feed/lib/feed-api";

type Listener = (comment: FeedComment) => void;

const listeners = new Map<string, Set<Listener>>();

export function emitEddieCreated(postId: string, comment: FeedComment): void {
  for (const listener of listeners.get(postId) ?? []) {
    listener(comment);
  }
}

export function subscribeEddieCreated(
  postId: string,
  listener: Listener
): () => void {
  const set = listeners.get(postId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(postId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(postId);
    }
  };
}
