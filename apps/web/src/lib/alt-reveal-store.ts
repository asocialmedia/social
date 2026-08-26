import { useSyncExternalStore } from "react";

// Cross-surface toggle for revealing uploader alt text inline under a post's
// media, keyed by post id. The more-menu on any surface flips it; the media
// grid on that surface reads it. In-memory only - revealing alt text is a
// transient reading aid, not a preference worth persisting.

const revealedPostIds = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleAltReveal(postId: string): void {
  if (revealedPostIds.has(postId)) {
    revealedPostIds.delete(postId);
  } else {
    revealedPostIds.add(postId);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useAltRevealed(postId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (postId ? revealedPostIds.has(postId) : false),
    () => false
  );
}
