"use client";

import type { MessageData } from "@asm/db";
import { useEffect, useMemo, useRef } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import {
  MAX_SEARCH_INDEX_MESSAGES,
  MIN_SEARCH_QUERY_LENGTH,
} from "@/lib/messages/message-search";
import type { RankedSearchResult } from "@/lib/messages/message-search";
import { cn } from "@/lib/utils";

// The list half of chat search, rendered as a full surface inside the DM. It is
// deliberately chrome-free: the search bar above already owns the mode toggle,
// the pager, the status, and the close. This is rows and nothing else, so the
// bar is the single place where the search UI changes state.
//
// Presentational — the thread owns the session (corpus, paging, debounced query,
// active page) and hands in the current page's slice.
interface MessageSearchResultsProps {
  activeIndex: number;
  allMessages: MessageData[];
  indexing: boolean;
  myUserId: string;
  onJump: (messageId: string) => void;
  query: string;
  results: RankedSearchResult[];
  truncated: boolean;
}

export function MessageSearchResults({
  activeIndex,
  allMessages,
  indexing,
  myUserId,
  onJump,
  query,
  results,
  truncated,
}: MessageSearchResultsProps) {
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  // Tracks the last row scrolled into view, so a re-render that does not move
  // the cursor does not yank the list back to the highlighted row.
  const prevActiveRef = useRef(activeIndex);

  const messagesById = useMemo(
    () => new Map(allMessages.map((message) => [message.id, message])),
    [allMessages]
  );

  useEffect(() => {
    if (prevActiveRef.current !== activeIndex) {
      prevActiveRef.current = activeIndex;
      activeRowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const queryReady = query.trim().length >= MIN_SEARCH_QUERY_LENGTH;
  const showNoResults = queryReady && results.length === 0 && !indexing;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {truncated ? (
        <p className="text-muted-foreground border-b border-[hsl(var(--border))] px-4 py-1.5 text-[11px]">
          Searching the {MAX_SEARCH_INDEX_MESSAGES.toLocaleString()} most recent
          messages.
        </p>
      ) : null}

      <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {results.map((result, index) => (
          <SearchResultRow
            active={index === activeIndex}
            key={result.id}
            message={messagesById.get(result.id)}
            myUserId={myUserId}
            onSelect={() => onJump(result.id)}
            ref={index === activeIndex ? activeRowRef : undefined}
            result={result}
          />
        ))}
        {showNoResults ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No messages match this search.
          </p>
        ) : null}
        {queryReady ? null : (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search this
            conversation.
          </p>
        )}
      </div>
    </div>
  );
}

interface SearchResultRowProps {
  active: boolean;
  message: MessageData | undefined;
  myUserId: string;
  onSelect: () => void;
  ref?: React.Ref<HTMLButtonElement | null>;
  result: RankedSearchResult;
}

function SearchResultRow({
  active,
  message,
  myUserId,
  onSelect,
  ref,
  result,
}: SearchResultRowProps) {
  const mine = message?.senderId === myUserId;
  const senderName = mine ? "You" : (message?.sender?.displayName ?? "them");
  return (
    <button
      aria-selected={active}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an option row with rich content; a native option cannot hold focus or rich layout like this
      role="option"
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active ? "bg-[hsl(var(--primary))]/10" : "hover:bg-muted/60"
      )}
      onClick={onSelect}
      onMouseEnter={(event) => {
        // Hover follows the mouse; focusing keeps screen-reader context on the
        // row without the list scrolling underneath the pointer.
        event.currentTarget.focus({ preventScroll: true });
      }}
      ref={ref}
      type="button"
    >
      <span className="mt-0.5 shrink-0">
        <UserAvatar avatarUrl={message?.sender?.avatarUrl ?? null} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-xs font-semibold">{senderName}</span>
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {formatSearchDate(result.createdAt)}
          </span>
        </span>
        <SnippetText result={result} />
      </span>
    </button>
  );
}

function SnippetText({ result }: { result: RankedSearchResult }) {
  const { snippet, ranges, text } = result;
  const prefix = snippet.offset > 0 ? "…" : "";
  const suffix = snippet.offset + snippet.text.length < text.length ? "…" : "";
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start > cursor) {
      segments.push(
        <span key={`t-${index}`}>
          {snippet.text.slice(cursor, range.start)}
        </span>
      );
    }
    segments.push(
      <mark
        className="rounded-sm bg-[hsl(var(--primary))]/25 px-px text-inherit"
        key={`m-${index}`}
      >
        {snippet.text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  }
  if (cursor < snippet.text.length) {
    segments.push(<span key="tail">{snippet.text.slice(cursor)}</span>);
  }
  return (
    <span className="text-muted-foreground line-clamp-2 text-[13px] leading-snug break-words">
      {prefix}
      {segments}
      {suffix}
    </span>
  );
}

function formatSearchDate(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return "";
  }
  const date = new Date(createdAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) {
    return time;
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
  }
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} ${time}`;
}
