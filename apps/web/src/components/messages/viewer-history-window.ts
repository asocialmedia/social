import type { MessagePage } from "@asm/db";

// Bounding policy for the fullscreen viewer's loaded transcript history.
//
// The viewer walks older history one page at a time, so every page it loads is
// genuinely being traversed and cannot simply be dropped. What CAN safely be
// bounded is stale history that lingers after the user has moved back toward
// recent images: when the active image is far from the oldest loaded one, the
// pages well below it are dead weight.
//
// Trimming is therefore gated on the viewer being a comfortable distance from
// the oldest item. Near the boundary the window is left intact, which is what
// makes it loop-safe: the boundary auto-loader can never re-fetch a page this
// policy just dropped, because trimming is disabled exactly when the boundary
// is reachable.

// Pages retained immediately before the anchor's page. Keeping a buffer means
// small backward steps after a trim never hit a hole.
export const VIEWER_HISTORY_KEEP_PAGES = 6;

// Minimum number of media items between the active image and the oldest known
// image before any trim is allowed. Media items, not messages, because that is
// the viewer's own coordinate space; 80 is a few pages of typical density and
// well beyond the boundary auto-load threshold.
export const VIEWER_HISTORY_MIN_OLDER_ITEMS = 80;

export interface ViewerHistoryTrimInput {
  // Viewer position: index of the active media item in the flattened list.
  activeIndex: number;
  // Finder returning the page index that contains a message id, or -1.
  findPageIndex: (messageId: string) => number;
  anchorMessageId: string | null;
  pageCount: number;
}

// Number of oldest pages that may be dropped right now, or 0 when trimming is
// unsafe. Pure so the policy is unit-tested independently of React Query.
export function pagesToDropForViewerHistory(
  input: ViewerHistoryTrimInput
): number {
  const { activeIndex, anchorMessageId, findPageIndex, pageCount } = input;
  if (!anchorMessageId || pageCount <= VIEWER_HISTORY_KEEP_PAGES + 1) {
    return 0;
  }
  if (activeIndex < VIEWER_HISTORY_MIN_OLDER_ITEMS) {
    return 0;
  }
  const anchorPage = findPageIndex(anchorMessageId);
  if (anchorPage < 0) {
    return 0;
  }
  const droppable = anchorPage - VIEWER_HISTORY_KEEP_PAGES;
  return Math.max(droppable, 0);
}

// ---- transcript retention ---------------------------------------------------
//
// The transcript's infinite query has no page cap, so scrolling up through a
// long conversation retains every page ever fetched (measured: ~102MB for a
// loaded 200k-message DM). Once a search jump can land anywhere in history via
// an anchored read, that unbounded growth becomes the crash vector rather than
// a slow leak, so the oldest pages are dropped once the reader has moved well
// clear of them.
//
// Same shape and same safety argument as the viewer's policy above: trimming is
// gated on the reader being a comfortable distance from the oldest loaded row,
// so the near-top auto-loader can never re-fetch a page this just dropped and
// spin in a load/trim loop.

// Pages retained before the anchor's page, as a buffer so a short scroll back
// does not immediately need the network again.
export const TRANSCRIPT_HISTORY_KEEP_PAGES = 8;

// Minimum number of rows between the top of the loaded list and the first
// visible row before any trim is allowed. Rows, not pages, because that is the
// viewport's coordinate space and the auto-loader's trigger is an index.
export const TRANSCRIPT_MIN_ROWS_ABOVE_BOUNDARY = 240;

export interface TranscriptHistoryTrimInput {
  // First message currently rendered in the viewport, or null before mount.
  anchorMessageId: string | null;
  // Index of the first row the virtualizer has mounted.
  firstVisibleIndex: number;
  // Finder returning the page index containing a message id, or -1.
  findPageIndex: (messageId: string) => number;
  pageCount: number;
}

// Number of oldest pages that may be dropped right now, or 0 when trimming is
// unsafe. Pure so the policy is unit-tested independently of the virtualizer.
export function pagesToDropForTranscriptHistory(
  input: TranscriptHistoryTrimInput
): number {
  const { anchorMessageId, findPageIndex, firstVisibleIndex, pageCount } =
    input;
  if (!anchorMessageId || pageCount <= TRANSCRIPT_HISTORY_KEEP_PAGES + 1) {
    return 0;
  }
  if (firstVisibleIndex < TRANSCRIPT_MIN_ROWS_ABOVE_BOUNDARY) {
    return 0;
  }
  const anchorPage = findPageIndex(anchorMessageId);
  if (anchorPage < 0) {
    return 0;
  }
  return Math.max(anchorPage - TRANSCRIPT_HISTORY_KEEP_PAGES, 0);
}

// Slices the oldest `drop` pages and their matching pageParams in lockstep.
// Slicing only `pages` would corrupt the infinite-query cursor chain.
// Generic over the page-param type: the transcript's params are direction-aware
// (`{ kind, cursor }`), and this must not care what they are, only that pages
// and params stay aligned.
export function trimOldestPages<TParam>(
  pages: MessagePage[],
  pageParams: TParam[],
  drop: number
): { pages: MessagePage[]; pageParams: TParam[] } {
  if (drop <= 0) {
    return { pageParams, pages };
  }
  return {
    pageParams: pageParams.slice(drop),
    pages: pages.slice(drop),
  };
}
