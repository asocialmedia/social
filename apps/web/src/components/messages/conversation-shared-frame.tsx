"use client";

import type { VirtualItem } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useEffect } from "react";

// The scroll + absolutely-positioned-rows shell shared by the details panel's
// three tabs. The transcript owns an equivalent inline (message-thread.tsx);
// extracting it here is what keeps the three tabs from each re-inventing the two
// rules that matter: the sized relative wrapper, and rows placed with
// `translateY` rather than layout, so scrolling never reflows.
//
// The virtualizer itself is NOT wrapped: the React Compiler refuses to memoize
// a hook that hands back one of its methods, so each tab calls `useVirtualizer`
// directly, exactly as the transcript does.
//
// The sized container is rendered even when the tab is empty. That is
// deliberate: the media grid measures it to choose its column count, and a
// container that only exists once there is something to show would leave the
// grid permanently unmeasured on the first open of an empty conversation.
export function VirtualRowsFrame({
  containerRef,
  empty,
  footer,
  isEmpty,
  renderRow,
  scrollRef,
  totalSize,
  virtualItems,
}: {
  // Attached to the sized container by tabs that measure their own width (the
  // media grid, whose column count follows the pane's real width).
  containerRef?: Ref<HTMLDivElement>;
  empty: ReactNode;
  // Rendered BELOW the sized container, inside the same scroller. A sibling rather
  // than an overlay, and inside rather than outside, for two reasons: a nested
  // scroller would steal the wheel from the list, and a position:fixed footer
  // would sit over the last row instead of after it.
  footer?: ReactNode;
  isEmpty: boolean;
  // Rows are rendered by `renderRow`, which owns attaching `measureElement` for
  // its variable-height rows. The grid omits it entirely: its rows are a pure
  // function of the pane's width, so there is nothing to measure.
  renderRow: (item: VirtualItem) => ReactNode;
  scrollRef: Ref<HTMLDivElement>;
  totalSize: number;
  virtualItems: readonly VirtualItem[];
}) {
  return (
    <div
      className="hide-native-scrollbar flex h-full flex-col overflow-y-auto overscroll-contain px-4 pt-1 pb-6"
      ref={scrollRef}
    >
      {/* `shrink-0` is load-bearing, not tidiness. The scroller is a column flex
          box, so this div is a flex item and its inline height is only a
          SUGGESTION: with the default `flex-shrink: 1` the item collapses to the
          scroller's own height and the height is discarded.

          The rows are absolutely positioned inside it, so a collapsed container does
          not clip them -- they escape, the scroller's scrollable extent becomes the
          last visible row rather than the whole list, and the footer below, which
          sits after the container in normal flow, is painted straight over the
          images. It also made a newly paged-in row appear above the viewport,
          because the extent it was added to was the wrong number. */}
      <div
        className="relative w-full shrink-0"
        ref={containerRef}
        style={{ height: isEmpty ? "100%" : totalSize }}
      >
        {isEmpty ? (
          <div className="absolute inset-0">{empty}</div>
        ) : (
          virtualItems.map((item) => renderRow(item))
        )}
      </div>
      {footer}
    </div>
  );
}

// How close to the end of a list the next page starts reading. A page is a local
// keyset read of sixty rows, so this is about smoothness rather than cost: starting
// a row or two early means the reader never sees the list stop and then start.
export const AUTO_LOAD_LAST_ROWS = 2;

// Whether an empty list is empty because the READ failed. A different answer from
// "this conversation has none" and from "a background walk has not arrived yet", and
// the one thing that must not be said when it is true is the indexing sentence:
// promising a backfill that is not running is the confident wrong answer this file
// exists to avoid.
export const READ_FAILED_FOOTNOTE =
  "Couldn't read the saved index, so this is only what this device has loaded.";

// Whether a virtualized list should read its next page.
//
// Auto-loading is right here BECAUSE the read is local. `loadMore` goes to the local
// refs index -- a keyset read of sixty rows out of IndexedDB, no request, no
// rate-limit budget, nothing a reader would ever want to refuse. The expensive part
// of this feature is the BACKFILL WALK, which fetches history over the network; that
// one is separately gated, runs on its own, and reports itself with its own line.
// Conflating the two is what put a button on the end of these lists, with a comment
// claiming a read the reader had not asked for.
//
// A list shorter than the pane is the case a scroll trigger misses entirely: there
// is nothing to scroll, so every row is already visible and the only way the pane
// fills is to keep reading. The threshold covers it by construction -- when the last
// row is above it, it is also the last row.
export function shouldAutoLoadMore(input: {
  hasMore: boolean;
  // -1 when no rows are laid out yet, which is the first paint before the
  // virtualizer has a scroll element.
  lastVisibleRow: number;
  readError: boolean;
  rowCount: number;
}): boolean {
  if (!input.hasMore || input.readError || input.lastVisibleRow < 0) {
    return false;
  }
  return input.lastVisibleRow >= input.rowCount - AUTO_LOAD_LAST_ROWS;
}

// Reads the next page once the end of the list comes into view.
//
// Keyed on the last visible row AND the row count rather than on an intersecting
// sentinel. After a page lands the sentinel has moved but is still on screen, so an
// IntersectionObserver would report no change and the chain would stall until the
// reader scrolled again -- which is the whole failure mode of a naive
// infinite-scroll sentinel. A row count that changed re-runs this, and that is what
// keeps the list filling until it is longer than the pane.
export function useAutoLoadMore(input: {
  hasMore: boolean;
  lastVisibleRow: number;
  loadMore: () => Promise<void>;
  readError: boolean;
  rowCount: number;
}): void {
  const { hasMore, lastVisibleRow, loadMore, readError, rowCount } = input;
  useEffect(() => {
    if (!shouldAutoLoadMore({ hasMore, lastVisibleRow, readError, rowCount })) {
      return;
    }
    // `readPage` serializes itself, so a burst of these from a fast scroll collapses
    // into one read rather than racing cursors.
    void loadMore();
  }, [hasMore, lastVisibleRow, loadMore, readError, rowCount]);
}

// The line under a list that says what is NOT shown yet.
//
// It says nothing about ordinary paging because there is nothing to say: the next
// page is read when the reader reaches it, silently, like every other list in the
// app. What is left is the two cases where the list genuinely is not the whole
// conversation and the reader could otherwise believe it is -- a background walk
// still running, and a store this device cannot read.
export function ListFooter({
  indexing,
  noun,
  readError,
}: {
  indexing: boolean;
  noun: string;
  readError: boolean;
}) {
  if (readError) {
    return (
      <p className="text-muted-foreground/80 py-3 text-center text-[11px]">
        Couldn&apos;t read the saved index, so this is only what this device has
        loaded.
      </p>
    );
  }
  if (indexing) {
    return (
      <p
        aria-live="polite"
        className="text-muted-foreground flex items-center justify-center gap-2 py-3 text-[11px]"
      >
        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
        Looking further back for older {noun}…
      </p>
    );
  }
  return null;
}

// The one empty state all three tabs share. The footnote is not a nicety.
//
// These tabs read a local index that a paced walk fills in the background, and
// "nothing here" is ambiguous between three very different states: the
// conversation genuinely has no X, a walk has not reached older messages yet, and
// this device has no index at all (private browsing, a fresh device, a store that
// failed to open). The reader knows which one it is, so it passes the sentence
// that matches — saying which is the difference between a correct answer and a
// confident wrong one.
export function EmptyShared({
  body,
  footnote,
  icon,
  title,
}: {
  body: string;
  footnote?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="chip-3d text-muted-foreground flex size-10 items-center justify-center rounded-full">
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs">{body}</p>
      {footnote ? (
        <p className="text-muted-foreground/70 max-w-[30ch] text-[11px]">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}
