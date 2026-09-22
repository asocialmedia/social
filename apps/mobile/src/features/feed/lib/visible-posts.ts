// Viewport visibility for feed videos: FeedList publishes the currently
// viewable post ids (the same viewability pass that feeds the view tracker)
// and each VideoTile subscribes without prop-drilling through every gallery
// layer. Bumps only fire when membership actually changes, so idle feeds do
// not re-render on every scroll frame.
let visibleIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function setVisiblePostIds(ids: ReadonlySet<string>): void {
  let same = ids.size === visibleIds.size;
  if (same) {
    for (const id of ids) {
      if (!visibleIds.has(id)) {
        same = false;
        break;
      }
    }
  }
  if (same) {
    return;
  }
  visibleIds = ids;
  for (const notify of listeners) {
    notify();
  }
}

export function isPostVisible(postId: string): boolean {
  return visibleIds.has(postId);
}

export function subscribePostVisibility(
  postId: string,
  notify: (visible: boolean) => void
): () => void {
  const listener = () => notify(visibleIds.has(postId));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
