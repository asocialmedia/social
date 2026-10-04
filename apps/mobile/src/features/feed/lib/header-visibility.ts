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
// The offset the current run of travel is measured from. Comparing only
// consecutive offsets meant a drag made of many sub-slip deltas never crossed
// HIDE_SLIP at all: each individual step stayed under it, so the header stayed
// put no matter how far the feed moved. Measuring from a baseline that only
// advances when a flip actually happens accumulates those small steps.
let baseline = 0;
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
  if (offsetY <= 0) {
    baseline = 0;
    if (hidden) {
      notify(false);
    }
    return;
  }
  // Hiding and showing both measure from the baseline, so a slow drag in
  // either direction still crosses its slip threshold. The baseline only moves
  // on a flip, which is what keeps the hysteresis honest: jitter under the
  // threshold never walks it away from the real resting offset.
  if (!hidden) {
    if (offsetY - baseline > HIDE_SLIP && offsetY > HIDE_AFTER) {
      baseline = offsetY;
      notify(true);
    }
    return;
  }
  if (baseline - offsetY > SHOW_SLIP) {
    baseline = offsetY;
    notify(false);
  }
}

export function resetHeaderScroll(): void {
  baseline = 0;
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
