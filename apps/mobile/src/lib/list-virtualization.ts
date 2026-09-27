// Shared FlatList virtualization tuning for every unbounded list in the app.
//
// The problem this solves: a FlatList left on RN's defaults (windowSize 21,
// initialNumToRender 10, maxToRenderPerBatch 10) keeps far more cards mounted
// than the viewport needs, and on an infinite feed the mounted set only ever
// grows. Measured on the Android emulator, scrolling the "For you" feed with
// defaults took the native View count from 4,443 to 6,752 and PSS past 1.2 GB,
// with 285ms mount/layout spikes on newly revealed cards. A post card is ~30
// native views (avatar + ring + 3D shadow layers, badge pills, seven action
// buttons), so the multiplier is steep.
//
// These values match the ones the gusts reel already ships with
// (gusts-screen.tsx), which is where the correct answer was worked out and then
// never applied to the other screens. Keeping them here means the next list
// picks them up by default instead of re-deriving them.
//
// Visual fidelity is unaffected: windowSize only changes how many off-screen
// cards stay mounted, never what any card renders. A card scrolled back into
// view remounts and draws identically, because every visual recipe (the 3D
// shadows, gradients, rings) lives in the card's own styles.
//
// getItemLayout is deliberately NOT part of this. Post and profile cards are
// variable height (media, tag pills, thread rails), so a fixed row estimate
// would make the scrollbar and scroll-offset restoration drift. The gusts reel
// and the media pager can use it because their rows are a known constant size.

/** Cards kept mounted either side of the viewport. 5 screens of runway. */
export const LIST_WINDOW_SIZE = 5;

/**
 * Cards rendered on the very first paint. 2 is enough to fill a tall phone
 * screen plus a little, and keeps the first frame off the critical path.
 */
export const LIST_INITIAL_RENDER = 2;

/**
 * Cards mounted per batch while scrolling. Small batches spread the mount cost
 * across frames instead of paying it in one spike.
 */
export const LIST_RENDER_BATCH = 3;

/**
 * Milliseconds VirtualizedList may spend mounting a batch before it yields to
 * the UI thread. 50 is RN's default; the explicit value documents that we want
 * the yielding behaviour and keeps it stable across RN upgrades.
 */
export const LIST_BATCH_UPDATE_MS = 50;

/** The tuning props, spread onto any unbounded FlatList. */
export const LIST_VIRTUALIZATION_PROPS = {
  initialNumToRender: LIST_INITIAL_RENDER,
  maxToRenderPerBatch: LIST_RENDER_BATCH,
  updateCellsBatchingPeriod: LIST_BATCH_UPDATE_MS,
  windowSize: LIST_WINDOW_SIZE,
} as const;
