"use client";

import { normalizeMessageSearchQuery } from "@asm/messages/search";
import { useEffect, useMemo, useRef } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import {
  MAX_SEARCH_INDEX_MESSAGES,
  MIN_SEARCH_QUERY_LENGTH,
} from "@/lib/messages/message-search";
import type { RankedSearchResult } from "@/lib/messages/message-search";
import type { MessageData } from "@/lib/messages/types";
import { cn } from "@/lib/utils";

import {
  isMessageSearchQueryTooLong,
  searchListEmptyState,
} from "./message-search-status";

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
  pageHitIds: string[];
  savedScope?: boolean;
  coverageUnavailable?: boolean;
  // A backfill walk is paging through older history right now. Told apart from
  // `indexing` (the transcript's own fill) because an empty page means something
  // different while a walk is running: more matches may still surface.
  indexingOlder: boolean;
  // A page turn is reading its window from the index. Shown in place of the rows
  // so a page turn reads as a read, not as an empty result set.
  listPageLoading: boolean;
  // A page turn failed. Rendered as a message rather than swallowed, so a failed
  // read is visible instead of a silently empty page.
  listPageError: string | null;
  // The window on screen predates the index generation on hand, so more matches
  // for this page may exist. The only state in which "still indexing" is the
  // truthful thing to say about an empty page.
  listPageStale: boolean;
  myUserId: string;
  members: { userId: string; displayName: string; avatarUrl: string | null }[];
  onJump: (messageId: string) => void;
  query: string;
  results: RankedSearchResult[];
  // The exact total over the whole result set, which can exceed the rows on
  // hand: the list pages one window at a time, so an empty page with a nonzero
  // total is "nothing resolved here", never "nothing matches".
  totalMatches: number;
  truncated: boolean;
}

export function MessageSearchResults({
  activeIndex,
  allMessages,
  pageHitIds,
  savedScope = false,
  coverageUnavailable = false,
  indexingOlder,
  listPageError,
  listPageLoading,
  listPageStale,
  myUserId,
  members,
  onJump,
  query,
  results,
  totalMatches,
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
  const sendersById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members]
  );
  const resultsById = useMemo(
    () => new Map(results.map((result) => [result.id, result])),
    [results]
  );

  useEffect(() => {
    if (prevActiveRef.current !== activeIndex) {
      prevActiveRef.current = activeIndex;
      activeRowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const queryReady = normalizeMessageSearchQuery(query).valid;
  // One empty state for the three ways a page can be empty: still reading,
  // failed to read, or resolved with nothing on it. The helper keeps the body's
  // wording and the bar's counter from contradicting each other -- an empty
  // page beside "29 matches" used to read "No messages match this search".
  const emptyState = searchListEmptyState({
    coverageUnavailable,
    // Server results do not depend on the transcript's separate history fetch.
    indexing: false,
    indexingOlder,
    listPageError,
    listPageLoading,
    listPageStale,
    queryReady,
    queryTooLong: isMessageSearchQueryTooLong(query),
    resultCount: pageHitIds.length,
    savedScope,
    totalMatches,
  });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {truncated ? (
        <p className="text-muted-foreground border-b border-[hsl(var(--border))] px-4 py-1.5 text-[11px]">
          Searching the {MAX_SEARCH_INDEX_MESSAGES.toLocaleString()} most recent
          messages.
        </p>
      ) : null}

      <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        <ul aria-label="Search results" className="m-0 list-none p-0">
          {pageHitIds.map((messageId, index) => {
            const result = resultsById.get(messageId);
            const message = messagesById.get(messageId);
            const sender = message
              ? sendersById.get(message.senderId)
              : undefined;
            return (
              <li key={messageId}>
                {result ? (
                  <SearchResultRow
                    active={index === activeIndex}
                    key={result.id}
                    message={message}
                    myUserId={myUserId}
                    onSelect={() => onJump(result.id)}
                    ref={index === activeIndex ? activeRowRef : undefined}
                    result={result}
                    sender={sender}
                  />
                ) : (
                  <button
                    aria-label={`Open message from ${message?.senderId === myUserId ? "you" : (sender?.displayName ?? "conversation member")}; preview unavailable`}
                    className={cn(
                      "flex min-h-[68px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                      index === activeIndex
                        ? "bg-[hsl(var(--primary))]/10"
                        : "hover:bg-muted/60"
                    )}
                    onClick={() => onJump(messageId)}
                    ref={index === activeIndex ? activeRowRef : undefined}
                    type="button"
                  >
                    <span className="mt-0.5 shrink-0">
                      <UserAvatar
                        avatarUrl={sender?.avatarUrl ?? null}
                        size={32}
                      />
                    </span>
                    <span className="text-muted-foreground text-sm">
                      Message preview unavailable. Open message to retry.
                    </span>
                  </button>
                )}
              </li>
            );
          })}
          {emptyState ? (
            <li>
              <p
                aria-live="polite"
                className="text-muted-foreground px-4 py-8 text-center text-sm"
              >
                {emptyState}
              </p>
            </li>
          ) : null}
          {queryReady ? null : (
            <li>
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search
                this conversation.
              </p>
            </li>
          )}
        </ul>
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
  sender?: { displayName: string; avatarUrl: string | null };
}

function SearchResultRow({
  active,
  message,
  myUserId,
  onSelect,
  ref,
  result,
  sender,
}: SearchResultRowProps) {
  const mine = message?.senderId === myUserId;
  const senderName = mine
    ? "You"
    : (message?.sender?.displayName ??
      sender?.displayName ??
      "Conversation member");
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-[68px] w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active ? "bg-[hsl(var(--primary))]/10" : "hover:bg-muted/60"
      )}
      onClick={onSelect}
      ref={ref}
      type="button"
    >
      <span className="mt-0.5 shrink-0">
        <UserAvatar
          avatarUrl={message?.sender?.avatarUrl ?? sender?.avatarUrl ?? null}
          size={32}
        />
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
