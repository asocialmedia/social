// Reel gesture math, ported from web's client-gusts + gust-card so the
// native pager behaves the same and the numbers are unit-tested:
// - pull to refresh: 0.45 resistance, capped at 96, fires past 56
// - tap vs double tap: a second tap inside 280ms is a double (amplify), a
//   lone tap toggles playback once the window closes
// - double-tap flame bursts: at most 7 alive, a small fan of rotations
// - the mount window: only the active card and its neighbours get a player

export const PULL_RESISTANCE = 0.45;
export const PULL_MAX = 96;
export const PULL_TRIGGER = 56;

export function pullDistance(dragDelta: number): number {
  if (dragDelta <= 0) {
    return 0;
  }
  return Math.min(dragDelta * PULL_RESISTANCE, PULL_MAX);
}

export function pullTriggers(distance: number): boolean {
  return distance >= PULL_TRIGGER;
}

export const DOUBLE_TAP_MS = 280;

export type TapKind = "double" | "single-pending";

// Classifies a tap given the previous tap's time; the caller commits a
// pending single after DOUBLE_TAP_MS unless a double cancels it.
export function classifyTap(now: number, lastTapAt: number | null): TapKind {
  return lastTapAt !== null && now - lastTapAt < DOUBLE_TAP_MS
    ? "double"
    : "single-pending";
}

export interface FlameBurst {
  id: number;
  rotate: number;
  x: number;
  y: number;
}

export const MAX_BURSTS = 7;
export const BURST_CLEAR_MS = 900;
export const BURST_DURATION_MS = 850;

// Web: rotate ((id % 5) - 2) * 8 degrees, so bursts fan out instead of
// stacking perfectly.
export function burstRotation(id: number): number {
  return ((id % 5) - 2) * 8;
}

export function addBurst(
  bursts: readonly FlameBurst[],
  burst: Omit<FlameBurst, "rotate">
): FlameBurst[] {
  return [...bursts, { ...burst, rotate: burstRotation(burst.id) }].slice(
    -MAX_BURSTS
  );
}

// Only active +- 1 mounts a player (web's shouldMountVideo).
export function shouldMountVideo(index: number, activeIndex: number): boolean {
  return Math.abs(index - activeIndex) <= 1;
}

// The live caption and paging spinner sit relative to the card; the pager
// asks for the next page this many items before the end (web's 200px
// sentinel is roughly the last card).
export const PREFETCH_REMAINING = 2;

export function shouldFetchMore(options: {
  activeIndex: number;
  hasNextPage: boolean;
  isFetching: boolean;
  total: number;
}): boolean {
  return (
    options.hasNextPage &&
    !options.isFetching &&
    options.total - 1 - options.activeIndex <= PREFETCH_REMAINING
  );
}

// Web: the caption is clamped to 3 lines with a More toggle once it runs
// past 80 characters.
export const CAPTION_TOGGLE_LENGTH = 80;

export function captionNeedsToggle(
  content: string | null | undefined
): boolean {
  return (content?.length ?? 0) > CAPTION_TOGGLE_LENGTH;
}
