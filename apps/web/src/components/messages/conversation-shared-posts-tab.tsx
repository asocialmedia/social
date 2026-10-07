"use client";

import noFeedImage from "@assets/general/nofeed.png";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef } from "react";

import type { SharedPostItem } from "@/lib/messages/shared-refs-format";

import {
  EmptyShared,
  ListFooter,
  READ_FAILED_FOOTNOTE,
  useAutoLoadMore,
  VirtualRowsFrame,
} from "./conversation-shared-frame";
import { PostEmbed } from "./post-embed";

// Posts shared in a conversation, as a virtualized list.
//
// Each row is one post card, rendered by the same PostEmbed the transcript's
// bubbles use — same fetch, same cache key, same explicit-content gate — so a
// share looks identical here and in the thread. `mine={false}` is deliberate:
// the pane is not inside anybody's bubble, so every card takes the neutral
// surface rather than the sender-tinted one.
//
// Rows are measured rather than fixed: a gust's cover is taller than a post's,
// and a moderated post has no cover at all, so a constant estimate would make
// the list jump as cards resolved.
const OVERSCAN_ROWS = 4;
// A loaded card is an author row + three clamped lines + an optional h-40/h-56
// cover + a footer. The skeleton in post-embed.tsx is shaped the same way, so
// this is also what a row measures before its query lands.
const ESTIMATED_ROW_SIZE = 300;

export function ConversationSharedPostsTab({
  hasMore,
  indexing,
  items,
  loadMore,
  readError,
}: {
  hasMore: boolean;
  indexing: boolean;
  items: readonly SharedPostItem[];
  loadMore: () => Promise<void>;
  readError: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  // oxlint-disable-next-line react/incompatible-library -- useVirtualizer returns unmemoizable measuring/scroll handles by design (upstream chat recipe, same as the transcript's); rows stay memoized on their own props
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => ESTIMATED_ROW_SIZE,
    getItemKey: (index) => items[index]?.flatKey ?? index,
    getScrollElement,
    overscan: OVERSCAN_ROWS,
  });
  const { measureElement } = rowVirtualizer;
  const totalSize = rowVirtualizer.getTotalSize();
  const virtualItems = rowVirtualizer.getVirtualItems();

  // Rows here are measured rather than fixed, so the threshold deliberately starts
  // the read a couple of rows early: a card can be taller than its estimate while a
  // query resolves, and reaching the bottom mid-measure is what makes a measured
  // list stutter.
  useAutoLoadMore({
    hasMore,
    lastVisibleRow: virtualItems.at(-1)?.index ?? -1,
    loadMore,
    readError,
    rowCount: items.length,
  });

  return (
    <VirtualRowsFrame
      empty={
        <EmptyShared
          body="Posts shared in this chat collect here."
          footnote={readError ? READ_FAILED_FOOTNOTE : EMPTY_FOOTNOTE}
          illustration={noFeedImage}
          title="No posts yet"
        />
      }
      footer={
        items.length === 0 ? null : (
          <ListFooter indexing={indexing} noun="posts" readError={readError} />
        )
      }
      isEmpty={items.length === 0}
      renderRow={(row) => {
        const item = items[row.index];
        if (!item) {
          return null;
        }
        return (
          <div
            className="absolute top-0 left-0 w-full pb-3"
            data-index={row.index}
            key={row.key}
            ref={measureElement}
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <PostEmbed mine={false} postId={item.postId} />
          </div>
        );
      }}
      scrollRef={scrollRef}
      totalSize={totalSize}
      virtualItems={virtualItems}
    />
  );
}

// Why the list may be empty, stated to the reader rather than assumed. The reader
// knows which case it is, and the same three sentences serve all three tabs.
//
// "A background index" rather than "once you open this panel": on a wide screen
// the details are the pinned pane beside the transcript, so they are already open
// and the walk is already running. The copy has to stay true for both surfaces.
export const EMPTY_FOOTNOTE =
  "Nothing here yet. Older posts are indexed in the background while you read, and without a local index only this device's loaded messages can be searched.";
