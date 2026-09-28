"use client";

import type { VirtualItem } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useState } from "react";

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
      <div
        className="relative w-full"
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

// The line under a list that says what is NOT shown yet, which is a different
// statement for each of the three cases and the difference matters:
//
//   - a walk still running: more is coming, and saying so beats an empty-looking
//     list that will fill in a minute;
//   - more stored: an explicit button, because a scroll-triggered read would fire
//     a query the user did not ask for and could not stop;
//   - neither: nothing at all, so a fully-shown list is not annotated with a
//     caveat about the index it does not need.
export function ListFooter({
  indexing,
  hasMore,
  loadMore,
  noun,
  readError,
}: {
  hasMore: boolean;
  indexing: boolean;
  loadMore: () => void;
  noun: string;
  readError: boolean;
}) {
  const [busy, setBusy] = useState(false);

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
  if (!hasMore) {
    return null;
  }
  return (
    <div className="flex justify-center py-3">
      <button
        className="btn-3d-gray inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          loadMore();
        }}
        type="button"
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
        ) : null}
        Load older {noun}
      </button>
    </div>
  );
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
