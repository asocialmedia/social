"use client";

import { MessageCircle, Search, WifiOff } from "lucide-react";
import type { KeyboardEvent, ReactNode, UIEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import UserAvatar from "@/components/layouts/user/user-avatar";
import type { SearchUserResult } from "@/lib/messages/client";
import { focusSearchResult } from "@/lib/messages/search-result-navigation";
import type { GlobalMessageSearchResult } from "@/lib/messages/use-global-message-search";
import { cn, formatRelativeDate } from "@/lib/utils";

import { GlobalMessageSearchProfiles } from "./global-message-search-profiles";
import { SearchRetryButton } from "./search-retry-button";

interface GlobalMessageSearchResultsProps {
  coverageComplete: boolean;
  coveragePaused: boolean;
  creatingProfileId: string | null;
  error: string | null;
  focusMessageId: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  messageQueryValid: boolean;
  myUserId: string;
  onEscape?: () => void;
  onLoadMore: () => void;
  onProfileRetry: () => void;
  onProfileSelect: (profile: SearchUserResult) => void;
  onProfileToggleExpanded: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onScrollPositionChange: (scrollTop: number) => void;
  onSelect: (result: GlobalMessageSearchResult) => void;
  profileError: string | null;
  profileRetryAt?: number;
  profileExpanded: boolean;
  profileLoading: boolean;
  profiles: readonly SearchUserResult[];
  query: string;
  results: readonly GlobalMessageSearchResult[];
  restoreScrollTop: number;
  retryAt?: number;
}

export function GlobalMessageSearchResults({
  coverageComplete,
  coveragePaused,
  creatingProfileId,
  error,
  focusMessageId,
  hasMore,
  loading,
  loadingMore,
  messageQueryValid,
  myUserId,
  onEscape,
  onLoadMore,
  onProfileRetry,
  onProfileSelect,
  onProfileToggleExpanded,
  onRefresh,
  onRetry,
  onScrollPositionChange,
  onSelect,
  profileError,
  profileRetryAt,
  profileExpanded,
  profileLoading,
  profiles,
  query,
  results,
  restoreScrollTop,
  retryAt,
}: GlobalMessageSearchResultsProps) {
  const resultsListRef = useRef<HTMLUListElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const lastFocusedMessageId = useRef<string | null>(null);
  const lastRestoredScrollTop = useRef<number | null>(null);
  const messagesHeadingRef = useRef<HTMLHeadingElement>(null);
  const handleResultKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape?.();
      } else if (
        focusSearchResult(
          scrollContainerRef.current,
          event.key,
          event.currentTarget
        )
      ) {
        event.preventDefault();
      }
    },
    [onEscape]
  );
  const handleSkipToMessages = useCallback(() => {
    const firstMessage =
      resultsListRef.current?.querySelector<HTMLButtonElement>(
        "button[data-search-result]"
      );
    (firstMessage ?? messagesHeadingRef.current)?.focus({
      preventScroll: true,
    });
    messagesHeadingRef.current?.scrollIntoView({ block: "start" });
  }, []);
  const handleResultsScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      onScrollPositionChange(event.currentTarget.scrollTop);
    },
    [onScrollPositionChange]
  );
  let message = `${profiles.length} profiles and ${results.length} loaded messages`;
  if (loading && profileLoading) {
    message = "Searching profiles and messages";
  } else if (profileLoading) {
    message = "Searching profiles";
  } else if (loading) {
    message = "Searching messages";
  } else if (error || profileError) {
    message = [profileError, error].filter(Boolean).join(" ");
  }

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    if (restoreScrollTop === 0) {
      scrollContainer.scrollTop = 0;
      lastRestoredScrollTop.current = null;
      return;
    }
    if (
      loading ||
      profileLoading ||
      restoreScrollTop === lastRestoredScrollTop.current
    ) {
      return;
    }
    scrollContainer.scrollTop = restoreScrollTop;
    lastRestoredScrollTop.current = restoreScrollTop;
  }, [loading, profileLoading, restoreScrollTop]);

  useEffect(() => {
    if (
      !focusMessageId ||
      focusMessageId === lastFocusedMessageId.current ||
      !resultsListRef.current ||
      !results.some((result) => result.hit.id === focusMessageId)
    ) {
      return;
    }
    const targetButton = [
      ...resultsListRef.current.querySelectorAll<HTMLButtonElement>(
        "button[data-message-id]"
      ),
    ].find((button) => button.dataset.messageId === focusMessageId);
    if (targetButton) {
      targetButton.focus({ preventScroll: true });
      lastFocusedMessageId.current = focusMessageId;
    }
  }, [focusMessageId, results]);

  function renderMessageResults() {
    if (error && results.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 px-5 py-9 text-center">
          <WifiOff className="text-muted-foreground/70 h-5 w-5" />
          <p className="text-muted-foreground m-0 max-w-60 text-xs leading-relaxed">
            {error}
          </p>
          <SearchRetryButton
            onKeyDown={handleResultKeyDown}
            onRetry={onRetry}
            retryAt={retryAt}
          />
        </div>
      );
    }

    if (loading && results.length === 0) {
      return (
        <output aria-label="Searching messages" className="space-y-2 p-1">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              className="flex min-h-[76px] animate-pulse items-center gap-3 rounded-xl px-2 motion-reduce:animate-none"
              key={index}
            >
              <span className="bg-muted h-10 w-10 shrink-0 rounded-[30%]" />
              <span className="min-w-0 flex-1 space-y-2">
                <span className="bg-muted block h-3 w-2/3 rounded" />
                <span className="bg-muted/70 block h-3 w-full rounded" />
              </span>
            </span>
          ))}
        </output>
      );
    }

    if (results.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          {coverageComplete ? (
            <MessageCircle className="text-muted-foreground/50 h-6 w-6" />
          ) : (
            <Search className="text-muted-foreground/50 h-6 w-6" />
          )}
          <p className="text-muted-foreground m-0 max-w-60 text-xs leading-relaxed">
            {coverageComplete
              ? `No messages match “${query.trim()}”.`
              : "No matches are indexed yet. Try again after more history has been indexed."}
          </p>
        </div>
      );
    }

    return (
      <ul
        aria-label="Message search results"
        className="m-0 list-none space-y-1 p-0"
        ref={resultsListRef}
      >
        {results.map((result) => (
          <li key={`${result.hit.conversationId}:${result.hit.id}`}>
            <button
              aria-label={getResultLabel(result, myUserId)}
              aria-current={
                result.hit.id === focusMessageId ? "true" : undefined
              }
              className={cn(
                "group hover:bg-muted/50 flex min-h-20 w-full items-start gap-2.5 rounded-xl px-2 py-3 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] motion-reduce:transition-none",
                result.hit.id === focusMessageId
                  ? "bg-[hsl(var(--primary))]/10 ring-1 ring-[hsl(var(--primary))]/25 ring-inset"
                  : "",
                result.previewFailed ? "opacity-80" : ""
              )}
              data-message-id={result.hit.id}
              data-search-result
              onClick={() => onSelect(result)}
              onKeyDown={handleResultKeyDown}
              type="button"
            >
              <UserAvatar
                avatarUrl={getConversationAvatarUrl(result)}
                className="h-9 w-9 shrink-0"
                seed={result.hit.conversationId}
                size={36}
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold">
                    {getConversationTitle(result)}
                  </span>
                  <time
                    className="text-muted-foreground shrink-0 text-[10px] tabular-nums"
                    dateTime={result.hit.createdAt}
                  >
                    {formatRelativeDate(new Date(result.hit.createdAt))}
                  </time>
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                  {result.hit.senderId === myUserId
                    ? "You"
                    : result.hit.senderName}
                  {result.hit.conversationType === "DEN" &&
                  result.hit.senderUsername
                    ? ` · @${result.hit.senderUsername}`
                    : ""}
                </span>
                <span className="mt-1 line-clamp-2 text-[13px] leading-5 wrap-anywhere">
                  <SearchPreview result={result} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      id="unified-message-search-results"
    >
      <output aria-live="polite" className="sr-only">
        {message}
      </output>

      <section
        aria-label="Search results"
        className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-1 pb-4 outline-none"
        onScroll={handleResultsScroll}
        ref={scrollContainerRef}
        tabIndex={-1}
      >
        <GlobalMessageSearchProfiles
          creatingId={creatingProfileId}
          error={profileError}
          expanded={profileExpanded}
          loading={profileLoading}
          onRetry={onProfileRetry}
          onResultKeyDown={handleResultKeyDown}
          onSelect={onProfileSelect}
          onSkipToMessages={handleSkipToMessages}
          onToggleExpanded={onProfileToggleExpanded}
          profiles={profiles}
          query={query}
          retryAt={profileRetryAt}
        />

        <section
          aria-labelledby="global-search-messages-heading"
          aria-busy={loading || loadingMore}
          className="mt-3 border-t border-[hsl(var(--border))]/70 pt-3"
        >
          <div className="mb-2 flex min-h-8 items-center justify-between px-2">
            <h3
              className="text-foreground m-0 text-sm font-semibold tracking-tight"
              id="global-search-messages-heading"
              ref={messagesHeadingRef}
              tabIndex={-1}
            >
              Messages
            </h3>
          </div>

          {messageQueryValid ? (
            <>
              {coverageComplete || loading || error ? null : (
                <div className="border-border/60 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs">
                  <span className="text-muted-foreground mt-0.5 shrink-0">
                    {coveragePaused ? (
                      <WifiOff className="h-3.5 w-3.5" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <p className="text-muted-foreground m-0 flex-1 leading-relaxed">
                    {coveragePaused
                      ? "Some older history is temporarily unavailable. Available matches appear below."
                      : "Some older history is still being prepared. Available matches appear below."}
                  </p>
                  {loading ? null : (
                    <button
                      className="min-h-11 shrink-0 rounded-lg px-2 font-medium text-[hsl(var(--primary))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      onClick={onRefresh}
                      onKeyDown={handleResultKeyDown}
                      data-search-result
                      type="button"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              )}

              {renderMessageResults()}

              {error && results.length > 0 ? (
                <output className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-2">
                  <p className="text-muted-foreground m-0 text-xs leading-relaxed">
                    {error} Your loaded matches are still available.
                  </p>
                  <SearchRetryButton
                    onKeyDown={handleResultKeyDown}
                    onRetry={onRetry}
                    retryAt={retryAt}
                  />
                </output>
              ) : null}

              {hasMore && !error ? (
                <button
                  className="btn-3d-gray mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium"
                  disabled={loadingMore}
                  data-search-result
                  onClick={onLoadMore}
                  onKeyDown={handleResultKeyDown}
                  type="button"
                >
                  {loadingMore ? (
                    <ZephLoader variant="search" className="h-3.5 w-3.5" />
                  ) : null}
                  {loadingMore
                    ? "Loading older results…"
                    : "Load older results"}
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground m-0 px-3 py-3 text-xs leading-relaxed">
              Enter at least two characters to search messages.
            </p>
          )}
        </section>
      </section>
    </div>
  );
}

function getConversationAvatarUrl(
  result: GlobalMessageSearchResult
): string | null {
  if (result.hit.conversationType === "DM") {
    return result.hit.peerAvatarUrl;
  }
  return result.hit.conversationAvatarMediaId
    ? `/api/media/${result.hit.conversationAvatarMediaId}`
    : null;
}

function getConversationTitle(result: GlobalMessageSearchResult): string {
  if (result.hit.conversationType === "DM") {
    return result.hit.peerName ?? result.hit.peerUsername ?? "Direct message";
  }
  return result.hit.conversationName ?? "Den";
}

function getResultLabel(
  result: GlobalMessageSearchResult,
  myUserId: string
): string {
  const sender =
    result.hit.senderId === myUserId ? "you" : result.hit.senderName;
  if (!result.preview) {
    return `Open matching message from ${sender}`;
  }
  return `Open message from ${sender} in ${getConversationTitle(result)}`;
}

function SearchPreview({ result }: { result: GlobalMessageSearchResult }) {
  if (result.preview) {
    return <HighlightedSnippet result={result} />;
  }
  if (result.previewFailed) {
    return (
      <span className="text-muted-foreground">
        Preview unavailable · open message
      </span>
    );
  }
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5">
      <ZephLoader
        variant="search"
        className="h-3 w-3 motion-reduce:animate-none"
      />
      Decrypting preview…
    </span>
  );
}

function HighlightedSnippet({ result }: { result: GlobalMessageSearchResult }) {
  const { preview } = result;
  if (!preview) {
    return null;
  }
  const { offset, text } = preview.snippet;
  const { ranges } = preview;
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start > cursor) {
      pieces.push(text.slice(cursor, range.start));
    }
    if (range.end > cursor) {
      pieces.push(
        <mark
          className="text-foreground rounded-sm bg-[hsl(var(--primary))]/20 px-0.5"
          key={`${range.start}:${index}`}
        >
          {text.slice(Math.max(cursor, range.start), range.end)}
        </mark>
      );
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    pieces.push(text.slice(cursor));
  }
  return (
    <>
      {offset > 0 ? "…" : ""}
      {pieces}
      {offset + text.length < preview.text.length ? "…" : ""}
    </>
  );
}
