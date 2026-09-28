"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Link2 } from "lucide-react";
import { useCallback, useRef } from "react";

import type { SharedLinkItem } from "@/lib/messages/shared-refs-format";

import {
  EmptyShared,
  ListFooter,
  VirtualRowsFrame,
} from "./conversation-shared-frame";
import { EMPTY_FOOTNOTE } from "./conversation-shared-posts-tab";
import { LinkEmbedCard } from "./message-link-embed";

// Links shared in a conversation, as a virtualized list.
//
// Each row hands its URL to the same LinkEmbedCard the message bubble unfurls,
// so the pane and the thread cannot disagree about a link: one request, one
// cache key, one preview, one YouTube-vs-card decision — and no second unfurling
// path to keep in sync.
//
// Only EXTERNAL links land here. A pasted link to an in-app post is a post
// share, and the conversation's own index builder files it under Posts so the
// two tabs never list the same share twice.
const OVERSCAN_ROWS = 4;
// A resolved preview is a h-24-ish card (the unfurl skeleton's own height, which
// is deliberately fixed so a bubble never re-measures when a preview lands).
const ESTIMATED_ROW_SIZE = 132;

export function ConversationSharedLinksTab({
  hasMore,
  indexing,
  items,
  loadMore,
  readError,
}: {
  hasMore: boolean;
  indexing: boolean;
  items: readonly SharedLinkItem[];
  loadMore: () => void;
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

  return (
    <VirtualRowsFrame
      empty={
        <EmptyShared
          body="Links sent in this chat collect here."
          footnote={EMPTY_FOOTNOTE}
          icon={<Link2 className="size-5" />}
          title="No links yet"
        />
      }
      footer={
        items.length === 0 ? null : (
          <ListFooter
            hasMore={hasMore}
            indexing={indexing}
            loadMore={loadMore}
            noun="links"
            readError={readError}
          />
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
            <LinkEmbedCard mine={false} url={item.url} />
          </div>
        );
      }}
      scrollRef={scrollRef}
      totalSize={totalSize}
      virtualItems={virtualItems}
    />
  );
}
