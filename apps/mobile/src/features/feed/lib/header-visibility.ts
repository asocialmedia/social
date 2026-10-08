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
// Track the furthest offset in the current direction, so reversing anywhere
// in a long feed reveals the controls after the same small upward travel.
let baseline = 0;
const listeners = new Set<(isHidden: boolean) => void>();

// Hysteresis: hiding takes a deliberate push down, showing takes a
// deliberate pull up. The old 4px slip flipped on touch jitter and momentum
// bounce, so a tad up/down around the threshold flickered both bars.
const HIDE_SLIP = 12;
const SHOW_SLIP = 12;
const HIDE_AFTER = 100;

export function setHeaderHidden(next: boolean): void {
  if (hidden === next) {
    return;
  }
  hidden = next;
  for (const listener of listeners) {
    listener(next);
  }
}

export interface HeaderScrollState {
  baseline: number;
  hidden: boolean;
}

// Shared by the UI-thread feed handler and other screens' JS scroll handlers.
export function advanceHeaderScroll(
  state: HeaderScrollState,
  offsetY: number
): void {
  "worklet";
  if (offsetY <= 0) {
    state.baseline = 0;
    state.hidden = false;
  } else if (state.hidden) {
    state.baseline = Math.max(state.baseline, offsetY);
    if (state.baseline - offsetY > SHOW_SLIP) {
      state.baseline = offsetY;
      state.hidden = false;
    }
  } else {
    state.baseline = Math.min(state.baseline, offsetY);
    if (offsetY - state.baseline > HIDE_SLIP && offsetY > HIDE_AFTER) {
      state.baseline = offsetY;
      state.hidden = true;
    }
  }
}

export function reportFeedScroll(offsetY: number): void {
  const next = { baseline, hidden };
  advanceHeaderScroll(next, offsetY);
  ({ baseline } = next);
  setHeaderHidden(next.hidden);
}

export function resetHeaderScroll(offsetY = 0): void {
  baseline = Math.max(0, offsetY);
  setHeaderHidden(false);
}

export function subscribeHeaderVisibility(
  notifyHidden: (isHidden: boolean) => void
): () => void {
  listeners.add(notifyHidden);
  return () => {
    listeners.delete(notifyHidden);
  };
}
