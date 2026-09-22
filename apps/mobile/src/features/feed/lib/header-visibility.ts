// Hide-on-scroll for the mobile feed header: FeedList reports the active
// tab's scroll offset, and MobileHeader subscribes. Scrolling down past a
// small threshold hides the bar; scrolling up (or hitting the top) brings
// it back. Notifications only fire on actual show/hide flips.
//
// The bar's height is a layout constant (minHeight 56 + 16 vertical
// padding = 72; its content fits without growing it), so the hide distance
// needs no measuring.
export const HEADER_BAR_HEIGHT = 72;
let hidden = false;
let lastOffset = 0;
const listeners = new Set<(isHidden: boolean) => void>();

const HIDE_SLIP = 4;
const HIDE_AFTER = 64;

function notify(next: boolean): void {
  hidden = next;
  for (const listener of listeners) {
    listener(next);
  }
}

export function reportFeedScroll(offsetY: number): void {
  const previous = lastOffset;
  lastOffset = offsetY;
  if (offsetY <= 0) {
    if (hidden) {
      notify(false);
    }
    return;
  }
  if (!hidden && offsetY - previous > HIDE_SLIP && offsetY > HIDE_AFTER) {
    notify(true);
    return;
  }
  if (hidden && previous - offsetY > HIDE_SLIP) {
    notify(false);
  }
}

export function resetHeaderScroll(): void {
  lastOffset = 0;
  if (hidden) {
    notify(false);
  }
}

export function subscribeHeaderVisibility(
  notifyHidden: (isHidden: boolean) => void
): () => void {
  listeners.add(notifyHidden);
  return () => {
    listeners.delete(notifyHidden);
  };
}
