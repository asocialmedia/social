"use client";

import noMediaImage from "@assets/general/nomedia.png";
import { useVirtualizer } from "@tanstack/react-virtual";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { getMessageMediaVariantUrl } from "@/lib/utils/image-url";

import {
  EmptyShared,
  ListFooter,
  READ_FAILED_FOOTNOTE,
  useAutoLoadMore,
  VirtualRowsFrame,
} from "./conversation-shared-frame";
import { EMPTY_FOOTNOTE } from "./conversation-shared-posts-tab";
import type { ConversationMediaItem } from "./message-conversation-media";

// Shared media for a conversation, as a virtualized grid.
//
// Grid virtualization counts ROWS, not tiles: a row is a CSS grid of N equal
// columns, and the row height is a pure function of the pane's measured width.
// That means no measurement pass and no scroll compensation, so the grid cannot
// jitter, while still mounting only the visible handful of tiles — a
// conversation with five thousand images puts about two dozen nodes on screen.
//
// Column count follows the pane's real width rather than a viewport breakpoint,
// because the pane is a side sheet on desktop and a full-screen sheet on mobile
// and neither width matches the app's breakpoints.
const GAP = 6;
const OVERSCAN_ROWS = 3;
// Below this width a third column would put tiles under ~120px, which is below
// the size a photo reads as anything.
const THREE_COLUMN_MIN_WIDTH = 380;

export function ConversationSharedMediaTab({
  hasMore,
  indexing,
  items,
  loadMore,
  onOpen,
  readError,
}: {
  hasMore: boolean;
  indexing: boolean;
  items: readonly ConversationMediaItem[];
  loadMore: () => Promise<void>;
  onOpen: (item: ConversationMediaItem) => Promise<void> | void;
  opening: boolean;
  readError: boolean;
}) {
  // Measured on the sized container, not the scroller: the frame pads the
  // scroller, so the container is exactly the width the grid may use.
  const [measureRef, width] = useContentWidth();

  const columns = width >= THREE_COLUMN_MIN_WIDTH ? 3 : 2;
  const tile = (width - GAP * (columns - 1)) / columns;
  const rowCount = Math.ceil(items.length / columns);
  // The row pitch, and with it the scroll extent, are ARITHMETIC rather than the
  // virtualizer's measurement.
  //
  // This grid's rows are a pure function of the pane's width -- no `measureElement`,
  // no reflow, which is why the rows never jitter -- so the extent is knowable
  // exactly, and asking the virtualizer for it is asking a measuring cache to
  // report a length that was never measured.
  //
  // It reported one row on the first paint of a 60-row list, because the pane's
  // width arrives a frame after mount. The rows are absolutely positioned inside
  // the sized container, so a container a fraction of its real height does not clip
  // them: they escape it, the scroller's scrollable extent becomes the tallest row
  // rather than the list, and the footer -- which sits after the container in normal
  // flow -- is painted straight over the images. It also made appended pages appear
  // to arrive above the viewport, because the extent they were added to was wrong.
  const rowPitch = tile + GAP;
  const totalSize = rowCount * rowPitch;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  // oxlint-disable-next-line react/incompatible-library -- useVirtualizer returns unmemoizable measuring/scroll handles by design (upstream chat recipe, same as the transcript's); rows stay memoized on their own props
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    // The same number the extent is computed from, so the virtualizer's own scroll
    // math and the container it positions inside cannot disagree.
    estimateSize: () => rowPitch,
    // Keyed on the row's first tile, so a row keeps its identity (and its scroll
    // position) for as long as that item is still in the list.
    getItemKey: (row) => items[row * columns]?.flatKey ?? row,
    getScrollElement,
    overscan: OVERSCAN_ROWS,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  // `virtualItems.at(-1)` is the last row actually laid out, which for a grid of
  // fixed-height rows is exact -- no measurement to wait on, so the read starts on
  // the frame the end of the list becomes visible.
  useAutoLoadMore({
    hasMore,
    lastVisibleRow: virtualItems.at(-1)?.index ?? -1,
    loadMore,
    readError,
    rowCount,
  });

  // Pre-measurement there is no width to divide, so the virtualizer would be
  // sized from a negative row height. One frame of placeholders, laid out like
  // the real grid, keeps the pane from jumping when the measurement lands, and
  // the measuring ref stays attached to it: that is what lets the real grid size
  // itself on the very next render instead of waiting for a remount.
  if (width === 0) {
    return (
      <div className="h-full px-4 pt-1 pb-6" ref={measureRef}>
        {items.length === 0 ? (
          <EmptyShared
            body="Images and GIFs sent in this chat collect here."
            footnote={EMPTY_FOOTNOTE}
            illustration={noMediaImage}
            title="No media yet"
          />
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: 6 }, (_, index) => (
              <span
                className="bg-muted/50 aspect-square animate-pulse rounded-xl"
                key={index}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <VirtualRowsFrame
      containerRef={measureRef}
      empty={
        <EmptyShared
          body="Images and GIFs sent in this chat collect here."
          footnote={readError ? READ_FAILED_FOOTNOTE : EMPTY_FOOTNOTE}
          illustration={noMediaImage}
          title="No media yet"
        />
      }
      footer={
        items.length === 0 ? null : (
          <ListFooter indexing={indexing} noun="media" readError={readError} />
        )
      }
      isEmpty={items.length === 0}
      renderRow={(row) => (
        <div
          className="absolute top-0 left-0 grid w-full"
          key={row.key}
          style={{
            gap: GAP,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            height: tile,
            transform: `translateY(${row.start}px)`,
          }}
        >
          {items
            .slice(row.index * columns, row.index * columns + columns)
            .map((item) => (
              <MediaTile
                item={item}
                key={item.flatKey}
                onOpen={onOpen}
                size={tile}
              />
            ))}
        </div>
      )}
      scrollRef={scrollRef}
      totalSize={totalSize}
      virtualItems={virtualItems}
    />
  );
}

// The measured content width of an element, handed back as a callback ref
// rather than an object ref. That is the part that matters: the element this
// measures is mounted and unmounted with the tab's contents, and an object ref
// observed in an effect would have been null on the first render and never
// observed at all. A callback ref sees the node the moment it is attached.
//
// A ResizeObserver rather than a media query, because the sheet's width is a
// layout fact and not a viewport one: the same pane is a side sheet and a
// full-screen sheet depending on the screen, and it is resized by the OS split
// view and the desktop window independently of any breakpoint.
function useContentWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) {
      return;
    }
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // One place that tears the observer down, whether the node unmounts (React
  // calls the callback with null) or the whole pane does.
  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [measureRef, width];
}

// One square thumbnail. The tile itself is the button and the image is a
// non-interactive layer inside it, so the accessible name can describe the
// image rather than "button", and there is no nested-control problem.
function MediaTile({
  item,
  onOpen,
  size,
}: {
  item: ConversationMediaItem;
  onOpen: (item: ConversationMediaItem) => void;
  size: number;
}) {
  // A GIF stays on its original URL to animate; a raster prefers the smallest
  // derivative rung that covers the tile at 2x.
  const src =
    item.kind === "gif"
      ? item.url
      : (getMessageMediaVariantUrl(item.url, Math.round(size * 2)) ?? item.url);

  return (
    <button
      aria-label={item.kind === "gif" ? "Open shared GIF" : "Open shared image"}
      className="group relative min-w-0 overflow-hidden rounded-xl bg-black/15 outline-hidden transition-transform duration-200 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-inset motion-reduce:transform-none motion-reduce:transition-none"
      onClick={() => {
        void onOpen(item);
      }}
      style={{ height: size, width: size }}
      type="button"
    >
      <Image
        alt=""
        className="object-cover"
        decoding="async"
        fill
        loading="lazy"
        sizes={`${Math.round(size)}px`}
        src={src}
        // Session-gated media: the optimizer cannot fetch it without the
        // viewer's cookies, so the source is a pre-sized pipeline derivative.
        unoptimized
      />
      {item.kind === "gif" ? (
        <span className="chip-3d absolute top-1 left-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider">
          GIF
        </span>
      ) : null}
      <span className="absolute inset-0 bg-transparent transition-colors duration-200 group-hover:bg-black/10" />
    </button>
  );
}
