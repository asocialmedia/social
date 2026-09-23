// Viewport visibility for feed videos, plus the single autoplay owner.
//
// Two consumers share this module without prop-drilling through the gallery
// layers:
//   - `setVisiblePostIds` reports every viewable post (view tracking reads it,
//     and it is the general "on screen" signal);
//   - `setAutoplayPostId` reports the ONE post allowed to autoplay right now.
//
// Autoplay needs its own signal because "viewable" is not "one video". A
// viewable thread group can hold several posts, and two short cards can each
// cover half the viewport, so playing every visible id ran multiple players at
// once - heard as doubled, slightly detuned audio. The enabled feed therefore
// nominates a single owner (the topmost visible video) and every other tile
// stays paused.
//
// Bumps only fire when the value actually changes, so idle feeds do not
// re-render on every scroll frame.

let visibleIds: ReadonlySet<string> = new Set();
let autoplayPostId: string | null = null;
const listeners = new Set<() => void>();
const autoplayListeners = new Set<() => void>();

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
}

export function setVisiblePostIds(ids: ReadonlySet<string>): void {
  if (sameSet(ids, visibleIds)) {
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
  let last = visibleIds.has(postId);
  const listener = () => {
    const next = visibleIds.has(postId);
    if (next !== last) {
      last = next;
      notify(next);
    }
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Nominates the single post allowed to autoplay, or clears it with null.
export function setAutoplayPostId(postId: string | null): void {
  if (postId === autoplayPostId) {
    return;
  }
  autoplayPostId = postId;
  for (const notify of autoplayListeners) {
    notify();
  }
}

export function isAutoplayPost(postId: string): boolean {
  return autoplayPostId === postId;
}

// Notifies only when `postId` gains or loses the autoplay slot.
export function subscribeAutoplayPost(
  postId: string,
  notify: (isOwner: boolean) => void
): () => void {
  let last = autoplayPostId === postId;
  const listener = () => {
    const next = autoplayPostId === postId;
    if (next !== last) {
      last = next;
      notify(next);
    }
  };
  autoplayListeners.add(listener);
  return () => {
    autoplayListeners.delete(listener);
  };
}
