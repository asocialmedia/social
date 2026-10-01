// Hide-on-scroll for the mobile feed header: FeedList reports the active
// tab's scroll offset, and MobileHeader subscribes. Scrolling down past a
// small threshold hides the bar; scrolling up (or hitting the top) brings
// it back. Notifications only fire on actual show/hide flips.
//
// The bar's height is a layout constant (border-box minHeight 56, which
// already includes its 16 vertical padding plus border), so the hide distance
// needs no measuring.
export const HEADER_BAR_HEIGHT = 56;
let hidden = false;
let lastOffset = 0;
const listeners = new Set<(isHidden: boolean) => void>();

// Hysteresis: hiding takes a deliberate push down, showing takes a
// deliberate pull up. The old 4px slip flipped on touch jitter and momentum
// bounce, so a tad up/down around the threshold flickered both bars.
const HIDE_SLIP = 12;
const SHOW_SLIP = 12;
const HIDE_AFTER = 100;

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
  if (hidden && previous - offsetY > SHOW_SLIP) {
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
