// Pure scroll/arrival state helpers for the message transcript. Kept free of
// React and the DOM so the threshold and unread-count policy are unit-tested
// independently of the virtualizer.

// A viewport counts as "pinned to the bottom" when it is within this many
// pixels of the end. Matches the virtualizer's scrollEndThreshold so
// followOnAppend and the jump button agree on what "at the bottom" means.
export const PINNED_THRESHOLD_PX = 100;

export interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

// True when the scroll position is within `threshold` of the bottom. Guards
// against a zero/negative viewport (unmeasured element) returning true, which
// would otherwise show the jump button on a freshly mounted thread.
export function isNearBottom(
  metrics: ScrollMetrics,
  threshold = PINNED_THRESHOLD_PX
): boolean {
  const { clientHeight, scrollHeight, scrollTop } = metrics;
  if (clientHeight <= 0) {
    return true;
  }
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

// A jump longer than this skips the smooth-scroll animation. Smooth scrolling
// suppresses the virtualizer's own scroll compensation, so animating a long
// distance while rows below resize (decrypt/image growth) leaves the viewport
// drifting; past a screenful or two an instant landing is both faster and
// stable. Short hops still animate.
export const INSTANT_JUMP_DISTANCE_PX = 1000;

// Scroll behavior for "jump to latest": instant when far from the end, smooth
// for a short hop. An unmeasured viewport jumps instantly.
export function jumpBehavior(
  metrics: ScrollMetrics,
  instantDistance = INSTANT_JUMP_DISTANCE_PX
): ScrollBehavior {
  const { clientHeight, scrollHeight, scrollTop } = metrics;
  if (clientHeight <= 0) {
    return "auto";
  }
  const distance = scrollHeight - scrollTop - clientHeight;
  return distance > instantDistance ? "auto" : "smooth";
}

// Display cap for the unread badge so a long absence cannot render a huge
// number and blow out the button layout.
export const MAX_BADGE_COUNT = 99;

export function formatArrivalCount(count: number): string {
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);
}

// Next badge value after an event. Only peer messages arriving while the user
// is scrolled away count; the user's own sends and events received while
// pinned at the bottom never accrue a badge.
export function nextArrivalCount(
  current: number,
  event: { isOwn: boolean; pinned: boolean }
): number {
  if (event.isOwn || event.pinned) {
    return 0;
  }
  return current + 1;
}
