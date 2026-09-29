// Pull-to-refresh choreography, in one dependency-free module so the loader,
// the gesture hook and the tests all read the same numbers.
//
// This sequence is the app's slowest motion outside a page transition, and it
// runs on every refresh of every pull-to-refresh screen. It used to total ~2.2s
// from the moment the refresh resolved to the moment the list slid back into
// place, and the largest single cost was not an animation at all: a flat 1100ms
// hold on the "Feed updated" pill, over half the whole wait, spent doing
// nothing so the label could be read. The step animations were trimmed to match
// and the hold cut to a toast-like dwell, which keeps the badge, the pill
// opening and the label readable while cutting the wait by about a third.
//
// Every duration is a named step rather than a literal at its call site so the
// budget below is the real one: REFRESH_SETTLE_MS is computed from these same
// numbers, and the test pins it so a later tweak cannot quietly walk the wait
// back up.

export const REFRESH_TIMING = {
  // Spinner out, orange check badge pops in.
  badgeIn: 140,
  // The chip drops in from above when the refresh starts.
  chipDropIn: 180,
  // The chip slides up out of view at the end. The list's glide home is
  // deliberately the same number: they move as one object, so the two must
  // never drift apart.
  chipExit: 180,
  // How long the confirmation is held before it leaves. Long enough to read
  // "Feed updated", short enough not to feel like the app is stuck.
  hold: 600,
  // The label slides in, slightly after the pill starts opening.
  labelIn: 160,
  labelInDelay: 60,
  // The label slides back out before the pill folds.
  labelOut: 120,
  // The pill folds back into the round chip.
  pillFold: 180,
  // The chip widens from the round chip into the pill.
  pillOpen: 200,
  // A pull released short of the threshold eases the chip back up.
  pullRetreat: 140,
} as const;

// The pill opening and the label sliding in run in parallel, so the pair costs
// whichever of the two runs longer rather than the sum of both.
const PILL_OPEN_MS = Math.max(
  REFRESH_TIMING.pillOpen,
  REFRESH_TIMING.labelInDelay + REFRESH_TIMING.labelIn
);

/**
 * Milliseconds from the refresh resolving to the list sitting back in place:
 * badge in, pill opens, the confirmation holds, the label leaves, the pill
 * folds, the chip exits.
 */
export const REFRESH_SETTLE_MS =
  REFRESH_TIMING.badgeIn +
  PILL_OPEN_MS +
  REFRESH_TIMING.hold +
  REFRESH_TIMING.labelOut +
  REFRESH_TIMING.pillFold +
  REFRESH_TIMING.chipExit;
