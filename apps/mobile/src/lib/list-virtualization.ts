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

// Fast-fling blanking lives here: with too little runway the render window
// cannot keep up with momentum and rows pop in blank after the fling stops.
// windowSize 5 (2 screens a side) blanked on hard flings; 9 (4 screens a
// side) covers them while staying far below the RN default of 21 that
// measured 1.2 GB. Batches of 5 fill a screen per batch instead of chasing
// it across several, and 4 initial rows fill tall phones so tab restores
// never scrollToOffset past unmounted content.
// Cards kept mounted either side of the viewport. 9 screens of runway.
export const LIST_WINDOW_SIZE = 9;

// Cards rendered on the very first paint. 4 fills a tall phone screen plus
// a little, and keeps the first frame off the critical path.
export const LIST_INITIAL_RENDER = 4;

// Cards mounted per batch while scrolling. Batches of 5 fill roughly a
// screen per batch: smaller batches spread mount cost but visibly chase a
// fast fling with blank rows.
export const LIST_RENDER_BATCH = 5;

// Milliseconds VirtualizedList may spend mounting a batch before it yields to
// the UI thread. 50 is RN's default; the explicit value documents that we want
// the yielding behaviour and keeps it stable across RN upgrades.
export const LIST_BATCH_UPDATE_MS = 50;

// The tuning props, spread onto any unbounded FlatList.
export const LIST_VIRTUALIZATION_PROPS = {
  initialNumToRender: LIST_INITIAL_RENDER,
  maxToRenderPerBatch: LIST_RENDER_BATCH,
  updateCellsBatchingPeriod: LIST_BATCH_UPDATE_MS,
  windowSize: LIST_WINDOW_SIZE,
} as const;
