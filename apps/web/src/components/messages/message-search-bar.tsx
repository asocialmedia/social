"use client";

import { normalizeMessageSearchQuery } from "@asm/messages/search";
import { Input } from "@asm/ui/shadui/input";
import {
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS } from "@/lib/messages/search-client-metric-contract";
import {
  flushMessageSearchClientTelemetry,
  recordMessageSearchClientMetric,
  startMessageSearchLongTaskTelemetry,
} from "@/lib/messages/search-client-telemetry";

import {
  searchChatStatus,
  searchCoverageLabel,
  searchListStatus,
  isMessageSearchQueryTooLong,
  MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE,
  searchStorageStatus,
} from "./message-search-status";

const searchCountFormatter = new Intl.NumberFormat();
const formatSearchCount = (count: number) => searchCountFormatter.format(count);

// Which surface the search session is currently showing. One bar drives both:
// in `chat` it steps through matches in the live transcript, in `list` it pages
// the ranked results. The body below swaps to match.
export type SearchView = "chat" | "list";

// Telegram's search strip, adapted to carry both modes in one row: the field is
// constant, the controls to its right swap with the view. Presentational on
// purpose — the thread owns the session (corpus, paging, debounce, current
// match, active page) so the bar and the list can never disagree.
export interface MessageSearchBarProps {
  // 1-based position of the landed match in the transcript, 0 when none.
  activePosition: number;
  // A backfill walk is paging through older history right now.
  indexingOlder: boolean;
  // True while older history is still paging in for the transcript itself.
  indexing: boolean;
  // The last walk ended in failure. Rendered as a retry rather than an idle
  // offer, so a transient failure does not silently strand coverage.
  indexFailed: boolean;
  // A local write was refused for lack of storage. The status stays user-facing.
  storageFull: boolean;
  // The whole conversation has been indexed, so counts are trustworthy.
  fullyCovered: boolean;
  // The last jump landed nowhere: anchor read and bounded walk both missed.
  // Shown in place of the counter so a failed jump reads as a failure rather
  // than a hang. Cleared by the next attempt, which is itself the retry.
  jumpError: string | null;
  // The current result window is being read, or could not be. Carried into the
  // status line for the same reason as jumpError: a page that never arrives must
  // not leave the bar counting rows nobody can see.
  listPageError: string | null;
  listPageLoading?: boolean;
  // Rows the current page holds, which the list status needs to tell an
  // unresolved window from a short page.
  resultCount: number;
  // The page's window predates the index on hand, so it is waiting on commits
  // rather than on a read. Changes what the bar says about an empty page.
  listPageStale: boolean;
  // Owned by the thread so the Ctrl+F shortcut can pull focus back here.
  inputRef: React.RefObject<HTMLInputElement | null>;
  matchCount: number;
  onClose: () => void;
  // ArrowDown / ArrowUp. In the chat view they step matches through the
  // transcript; in the list view they move the highlighted row.
  onNext: () => void;
  // Enter. In the chat view it steps to the next match, in the list view it
  // jumps the highlighted row.
  onSubmit: () => void;
  // Pager buttons, list view only.
  onPage: (delta: 1 | -1) => void;
  onPrevious: () => void;
  onQueryChange: (query: string) => void;
  onToggleView: () => void;
  // Clamped page index and its bounds, for the list view's status.
  page: number;
  pageCount: number;
  canNextPage?: boolean;
  canPreviousPage?: boolean;
  query: string;
  rangeEnd: number;
  rangeStart: number;
  totalResults: number;
  view: SearchView;
  serverManaged?: boolean;
  searching?: boolean;
  searchError?: string | null;
  searchHasMore?: boolean;
  onRetrySearch?: () => void;
  onRetryJump?: () => void;
  offlineSearch?: boolean;
  savedHistorySearch?: boolean;
  coverageUnavailable?: boolean;
  totalMatchesExact?: boolean;
  countState?: "pending" | "exact" | "unavailable" | null;
  hasSelectedResult?: boolean;
}

export function MessageSearchBar({
  activePosition,
  fullyCovered,
  indexing,
  indexFailed,
  indexingOlder,
  inputRef,
  jumpError,
  listPageError,
  listPageLoading = false,
  matchCount,
  onClose,
  onNext,
  onPage,
  onPrevious,
  onQueryChange,
  onSubmit,
  onToggleView,
  page,
  pageCount,
  canNextPage = false,
  canPreviousPage,
  query,
  storageFull,
  rangeEnd,
  rangeStart,
  resultCount,
  listPageStale,
  totalResults,
  view,
  serverManaged = false,
  searching = false,
  searchError = null,
  searchHasMore = false,
  onRetrySearch,
  onRetryJump,
  offlineSearch = false,
  savedHistorySearch = false,
  coverageUnavailable = false,
  totalMatchesExact = true,
  countState = null,
  hasSelectedResult = false,
}: MessageSearchBarProps) {
  const queryChangedAtRef = useRef<number | null>(null);
  const sawSearchStartRef = useRef(false);
  const paintFrameIdsRef = useRef<number[]>([]);
  const listView = view === "list";
  const queryReady = normalizeMessageSearchQuery(query).valid;
  const queryTooLong = isMessageSearchQueryTooLong(query);
  const previousPageEnabled = canPreviousPage ?? page > 0;
  const coverageLabel = searchCoverageLabel({
    fullyCovered,
    indexFailed,
    indexingOlder,
  });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [inputRef]);

  useEffect(() => {
    const stopObserving = startMessageSearchLongTaskTelemetry();
    return () => {
      stopObserving();
      void flushMessageSearchClientTelemetry();
    };
  }, []);

  useEffect(() => {
    if (searching) {
      sawSearchStartRef.current = true;
      return;
    }
    if (!sawSearchStartRef.current) {
      return;
    }
    sawSearchStartRef.current = false;
    const startedAt = queryChangedAtRef.current;
    queryChangedAtRef.current = null;
    if (startedAt === null || !queryReady) {
      return;
    }
    const durationMs = performance.now() - startedAt;
    if (durationMs > MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS) {
      return;
    }
    let outcome: "empty" | "error" | "hits" | "offline";
    if (searchError) {
      outcome = "error";
    } else if (offlineSearch) {
      outcome = "offline";
    } else if (totalResults > 0) {
      outcome = "hits";
    } else {
      outcome = "empty";
    }
    recordMessageSearchClientMetric({
      durationMs,
      event: "result-ready",
      outcome,
    });
  }, [offlineSearch, queryReady, searchError, searching, totalResults]);

  useEffect(
    () => () => {
      for (const frameId of paintFrameIdsRef.current) {
        cancelAnimationFrame(frameId);
      }
    },
    []
  );

  // A failed jump replaces the counter: the miss must read as a miss, not as a
  // hang, and the next attempt (which clears it) is the retry.
  let statusText: string;
  let progressText = "";
  if (queryTooLong) {
    statusText = MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE;
  } else if (serverManaged) {
    if (jumpError) {
      statusText = jumpError;
    } else if (searchError) {
      statusText = "Search failed";
    } else if (!queryReady) {
      statusText = "";
    } else if (listView && resultCount > 0) {
      const visibleRange = `${formatSearchCount(rangeStart)}–${formatSearchCount(rangeEnd)}`;
      const knownCount = Math.max(totalResults, rangeEnd);
      if (totalMatchesExact) {
        statusText = `${visibleRange} of ${formatSearchCount(totalResults)}`;
      } else if (searchHasMore) {
        statusText = `${visibleRange} of ${formatSearchCount(knownCount)}+`;
      } else {
        statusText = `${visibleRange} of ${formatSearchCount(knownCount)} found so far`;
      }
    } else if (!listView && matchCount > 0) {
      const position = activePosition > 0 ? activePosition : 1;
      if (totalMatchesExact) {
        statusText = `${formatSearchCount(position)} of ${formatSearchCount(matchCount)}`;
      } else if (searchHasMore) {
        statusText = `${formatSearchCount(position)} of ${formatSearchCount(matchCount)}+`;
      } else {
        statusText = `${formatSearchCount(position)} of ${formatSearchCount(matchCount)} found so far`;
      }
    } else if (listView && listPageError) {
      statusText = "Results couldn't load";
    } else if (listView && listPageLoading) {
      statusText = "Loading results…";
    } else if (listView && listPageStale) {
      statusText = "Updating results…";
    } else if (listView && totalResults > 0) {
      statusText = "No matches on this page";
    } else if (searching) {
      statusText = "Searching…";
    } else if (coverageUnavailable && totalResults === 0) {
      statusText = "No matches in searchable history";
    } else if (!fullyCovered) {
      statusText = "Searching…";
    } else if (fullyCovered && totalMatchesExact) {
      statusText =
        offlineSearch || savedHistorySearch
          ? "No matching saved messages"
          : "No matching messages";
    } else {
      statusText = "";
    }
    if (!queryReady || jumpError || searchError) {
      progressText = "";
    } else if (offlineSearch) {
      progressText = "Offline — saved messages only";
    } else if (savedHistorySearch) {
      progressText = "Full search unavailable — showing saved messages";
    } else if (coverageUnavailable) {
      progressText = "Some older messages couldn't be searched";
    } else if (indexingOlder || !fullyCovered) {
      progressText = "Searching older messages…";
    } else if (countState === "pending") {
      progressText = "Counting results…";
    } else if (!totalMatchesExact && searchHasMore) {
      progressText = "More results available";
    } else if (countState === "unavailable") {
      progressText = "Exact total unavailable";
    }
  } else {
    statusText =
      jumpError ??
      listPageError ??
      (searchStorageStatus({ storageFull }) ||
        coverageLabel ||
        (listView
          ? searchListStatus({
              fullyCovered,
              indexingOlder,
              listPageStale,
              queryReady,
              rangeEnd,
              rangeStart,
              resultCount,
              totalResults,
            })
          : searchChatStatus({
              activePosition,
              fullyCovered,
              indexingOlder,
              matchCount,
              queryReady,
            })));
  }

  let retryLabel = "Retry";
  if (jumpError) {
    retryLabel = "Retry message";
  } else if (savedHistorySearch) {
    retryLabel = "Retry full search";
  }
  const pageLabel = totalMatchesExact
    ? `Page ${formatSearchCount(page + 1)} of ${formatSearchCount(pageCount)}`
    : `Page ${formatSearchCount(page + 1)}`;
  let viewToggleLabel = "Show results as a list";
  if (listView) {
    viewToggleLabel = "Show results in chat";
  } else if (hasSelectedResult) {
    viewToggleLabel = "Back to results";
  }

  return (
    <div className="border-border/60 flex shrink-0 flex-col gap-1.5 border-b px-3 py-2 md:h-12 md:flex-row md:items-center md:gap-2 md:px-4 md:py-0">
      <div className="flex min-w-0 items-center gap-2 md:flex-1">
        <Search className="text-muted-foreground h-4 w-4 shrink-0" />
        <Input
          aria-label="Search messages in this conversation"
          className="min-w-0 flex-1 border-0 bg-transparent shadow-none"
          onChange={(event) => {
            const startedAt = performance.now();
            queryChangedAtRef.current = startedAt;
            for (const frameId of paintFrameIdsRef.current) {
              cancelAnimationFrame(frameId);
            }
            paintFrameIdsRef.current = [];
            const firstFrame = requestAnimationFrame(() => {
              const secondFrame = requestAnimationFrame(() => {
                paintFrameIdsRef.current = [];
                const durationMs = performance.now() - startedAt;
                if (
                  durationMs <= MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS
                ) {
                  recordMessageSearchClientMetric({
                    durationMs,
                    event: "input-paint",
                  });
                }
              });
              paintFrameIdsRef.current.push(secondFrame);
            });
            paintFrameIdsRef.current.push(firstFrame);
            onQueryChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onNext();
            } else if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onPrevious();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Search messages"
          ref={inputRef}
          value={query}
        />
      </div>

      <div className="flex w-full min-w-0 items-center gap-1 md:w-auto">
        {/* Transcript window state, not index state: once the index covers the
          whole conversation, matches are found over everything regardless of
          how much history happens to be loaded, so a loader here would imply
          search is still working when it is done. */}
        {(serverManaged ? searching : indexing && !fullyCovered) ? (
          <Loader2
            aria-label="Loading older messages"
            className="text-muted-foreground h-3.5 w-3.5 shrink-0 animate-spin"
          />
        ) : null}

        <div className="flex min-h-8 min-w-0 flex-1 items-center justify-between gap-2 md:min-h-0 md:flex-none md:justify-start">
          <span
            aria-atomic="true"
            aria-live="polite"
            className="text-foreground min-w-0 truncate text-right text-xs tabular-nums md:text-left"
          >
            {statusText}
          </span>
          {progressText ? (
            <span className="text-muted-foreground min-w-0 truncate text-right text-[11px] md:max-w-48 md:text-left">
              {progressText}
            </span>
          ) : null}
        </div>
        {((serverManaged && (jumpError || searchError || savedHistorySearch)) ||
          (!serverManaged && (indexFailed || storageFull))) &&
        onRetrySearch ? (
          <button
            className="text-xs font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline"
            onClick={jumpError ? onRetryJump : onRetrySearch}
            type="button"
          >
            {retryLabel}
          </button>
        ) : null}

        {listView ? (
          <button
            aria-label="Previous page of results"
            className="icon-btn-3d flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-40 md:h-8 md:w-8"
            disabled={!previousPageEnabled}
            onClick={() => onPage(-1)}
            title="Previous page"
            type="button"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            aria-label="Previous match"
            className="icon-btn-3d flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-40 md:h-8 md:w-8"
            disabled={matchCount === 0}
            onClick={onPrevious}
            title="Previous match"
            type="button"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}

        {listView ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {pageLabel}
          </span>
        ) : null}

        {listView ? (
          <button
            aria-label="Next page of results"
            className="icon-btn-3d flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-40 md:h-8 md:w-8"
            disabled={!canNextPage}
            onClick={() => onPage(1)}
            title="Next page"
            type="button"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            aria-label="Next match"
            className="icon-btn-3d flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-40 md:h-8 md:w-8"
            disabled={matchCount === 0}
            onClick={onNext}
            title="Next match"
            type="button"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}

        {!serverManaged && indexingOlder ? (
          <span
            aria-label="Searching older messages"
            className="icon-btn-3d flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            title="Searching older messages"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : null}

        {/* The one control that changes what search means: swap the body between
          the live transcript and the ranked list. */}
        <button
          aria-label={viewToggleLabel}
          className="icon-btn-3d flex h-11 w-11 shrink-0 items-center justify-center rounded-full md:h-8 md:w-8"
          onClick={onToggleView}
          title={viewToggleLabel}
          type="button"
        >
          {listView ? (
            <MessageSquare className="h-3.5 w-3.5" />
          ) : (
            <List className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          aria-label="Close search"
          className="icon-btn-3d flex h-11 w-11 shrink-0 items-center justify-center rounded-full md:h-8 md:w-8"
          onClick={onClose}
          title="Close search"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
