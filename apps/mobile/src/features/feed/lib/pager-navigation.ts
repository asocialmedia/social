// Index math for the home feed pager, kept out of the component so the swipe
// rules are testable without react-native (bun cannot parse the native
// modules, and the gesture itself is not something a unit test can drive).
//
// Two decisions live here and they are deliberately different:
//
//   - `handoffIndex` answers "which page is this drag heading for" and is
//     asked on every move. It hands the tab over well before the swipe could
//     possibly commit, so the incoming feed starts fetching while the finger
//     is still down and its posts are on screen by the time the track settles.
//     Committing on the animation's completion instead made everything pop in
//     a beat after the slide landed.
//   - `settleIndex` answers "which page does this release land on" and keeps
//     web's rules: 56px of travel, or a short fast flick. A drag that does not
//     clear either springs back to the page it started from, so an early
//     hand-off can always be taken back.

// Horizontal travel (px) that commits a swipe on release, and the speed
// (px/ms) that commits a shorter flick. Same values as web.
export const SWIPE_DISTANCE = 56;
export const FLICK_VELOCITY = 0.6;
// Once the finger travels this far the gesture locks to horizontal or
// vertical; whichever axis is ahead wins.
export const DIRECTION_LOCK = 10;
// Travel at which a still-undecided drag hands the tab over. Well short of
// SWIPE_DISTANCE so the hand-off lands mid-gesture, but far enough that a
// wobble at the lock point cannot flip tabs.
export const HANDOFF_DISTANCE = 20;

export function clampIndex(index: number, pageCount: number): number {
  "worklet";
  return Math.min(Math.max(0, index), Math.max(0, pageCount - 1));
}

// The page a drag is currently heading for: the page it started on until the
// finger has clearly pointed at a neighbour, then that neighbour. Clamped, so
// a pull past the first or last page hands over to the edge instead of
// running off the track.
export function handoffIndex(
  origin: number,
  dx: number,
  pageCount: number
): number {
  "worklet";
  if (dx <= -HANDOFF_DISTANCE) {
    return clampIndex(origin + 1, pageCount);
  }
  if (dx >= HANDOFF_DISTANCE) {
    return clampIndex(origin - 1, pageCount);
  }
  return clampIndex(origin, pageCount);
}

// The page a release settles on, measured from the page the drag started on
// (not from the page it was handed over to, which a spring-back has to undo).
export function settleIndex(
  origin: number,
  dx: number,
  vx: number,
  pageCount: number
): number {
  "worklet";
  if (dx <= -SWIPE_DISTANCE || vx <= -FLICK_VELOCITY) {
    return clampIndex(origin + 1, pageCount);
  }
  if (dx >= SWIPE_DISTANCE || vx >= FLICK_VELOCITY) {
    return clampIndex(origin - 1, pageCount);
  }
  return clampIndex(origin, pageCount);
}
