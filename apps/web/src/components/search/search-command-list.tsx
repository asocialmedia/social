"use client";

import type {
  SearchHistoryItem,
  SearchPostResult,
  SearchUserResult,
} from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noSearchImage from "@assets/general/nosearch.png";
import { Clock3, Eye, Flame, TrendingUp, X } from "lucide-react";
import Image from "next/image";
import { useCallback } from "react";
import type { MouseEvent } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { normalizeHistoryItem } from "@/components/search/use-search-history";
import {
  cn,
  formatNumber,
  formatRelativeDate,
  formatSearchTime,
} from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface SearchCommandListProps {
  history?: (SearchHistoryItem | string)[];
  input: string;
  onClearHistory?: () => void;
  onRemoveHistoryItem?: (target: string) => void;
  onSelectPost: (post: SearchPostResult) => void;
  onSelectSuggestion: (value: string) => void;
  onSelectUser: (user: SearchUserResult) => void;
  posts?: SearchPostResult[];
  suggestions?: SearchSuggestion[];
  users?: SearchUserResult[];
}

interface SearchSuggestion {
  count: number;
  query: string;
}

const ROW_CLASS =
  "pill-3d-hover flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-all duration-200 ease-out text-foreground data-[selected=true]:bg-transparent";

export const SearchCommandList = ({
  input,
  suggestions,
  history,
  posts,
  users,
  onSelectPost,
  onSelectUser,
  onSelectSuggestion,
  onClearHistory,
  onRemoveHistoryItem,
}: SearchCommandListProps) => {
  const { user: currentUser } = useSession();

  const handleClearHistory = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onClearHistory?.();
    },
    [onClearHistory]
  );

  const handleRemoveHistoryItem = useCallback(
    (e: MouseEvent<HTMLButtonElement>, target: string) => {
      e.preventDefault();
      e.stopPropagation();
      onRemoveHistoryItem?.(target);
    },
    [onRemoveHistoryItem]
  );

  const handleUserClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      const user = users?.[index];
      if (user) {
        onSelectUser(user);
      }
    },
    [onSelectUser, users]
  );

  const handlePostClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      const post = posts?.[index];
      if (post) {
        onSelectPost(post);
      }
    },
    [onSelectPost, posts]
  );

  const handleSuggestionClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      const suggestion = suggestions?.[index];
      if (suggestion) {
        onSelectSuggestion(suggestion.query);
      }
    },
    [onSelectSuggestion, suggestions]
  );

  const handleRemoveHistoryClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const target =
        e.currentTarget.dataset.target || e.currentTarget.dataset.query;
      if (target) {
        handleRemoveHistoryItem(e, target);
      }
    },
    [handleRemoveHistoryItem]
  );

  const hasResults = (users && users.length > 0) || (posts && posts.length > 0);
  const hasQuery = Boolean(input.trim());

  return (
    <div className="apple-panel hide-native-scrollbar max-h-[min(68vh,440px)] overflow-x-hidden overflow-y-auto rounded-2xl p-1.5 shadow-none">
      {hasQuery && !hasResults && !suggestions?.length ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <Image
            alt=""
            className="h-20 w-auto object-contain"
            draggable={false}
            height={112}
            src={noSearchImage}
            width={112}
          />
          <p className="text-sm font-medium">
            No results for &quot;{input}&quot;
          </p>
          <p className="text-muted-foreground text-xs">
            Try a different name or topic
          </p>
        </div>
      ) : null}

      {users && users.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide uppercase">
            People
          </div>
          {users.map((user, index) => {
            const isSelf = Boolean(
              currentUser &&
              (user.id === currentUser.id ||
                user.username.toLowerCase() ===
                  currentUser.username.toLowerCase())
            );
            return (
              <button
                className={ROW_CLASS}
                data-index={index}
                key={`user-${user.id}`}
                onClick={handleUserClick}
                type="button"
              >
                <UserAvatar
                  avatarUrl={user.avatarUrl}
                  className="h-9 w-9 shrink-0"
                  size={36}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <span className="truncate">
                      {user.displayName || user.username}
                    </span>
                    {isSelf ? (
                      <span className="bg-primary/10 text-primary border-primary/20 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] leading-none font-semibold">
                        You
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    @{user.username}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatNumber(user.aura)} aura
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {posts && posts.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide uppercase">
            Posts
          </div>
          {posts.map((post, index) => (
            <button
              className={cn(
                ROW_CLASS,
                "relative max-h-23 items-start overflow-hidden py-2.5"
              )}
              data-index={index}
              key={`post-${post.id}`}
              onClick={handlePostClick}
              type="button"
            >
              <UserAvatar
                avatarUrl={post.authorAvatarUrl}
                className="h-9 w-9 shrink-0"
                size={36}
              />
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="line-clamp-3 overflow-hidden text-sm leading-[1.35] font-medium [overflow-wrap:anywhere] break-words">
                  {post.content}
                </span>
                <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2.5 text-xs">
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Flame
                      className={cn(
                        "h-3 w-3",
                        post.aura < 0 ? "text-[#7c5cff]" : "text-orange-500"
                      )}
                    />
                    {formatNumber(post.aura)}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Eye className="h-3 w-3" />
                    {formatNumber(post.viewCount)}
                  </span>
                  <span className="shrink-0">
                    {formatRelativeDate(post.createdAt)}
                  </span>
                </span>
              </span>
              {post.previewMedia ? (
                <div className="bg-muted relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                  <Image
                    alt=""
                    className={cn(
                      "h-full w-full object-cover",
                      post.explicitContent && "opacity-70 blur-md"
                    )}
                    fill
                    sizes="48px"
                    src={getMediaProxyUrl(post.previewMedia)}
                    unoptimized
                  />
                  {post.previewMedia.type === "VIDEO" ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow-sm">
                        <span className="ml-px h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent border-l-zinc-900" />
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {suggestions && suggestions.length > 0 && !hasQuery ? (
        <div className="flex flex-col gap-0.5">
          <div className="text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide uppercase">
            Suggestions
          </div>
          {suggestions.map((suggestion, index) => (
            <button
              className={ROW_CLASS}
              data-index={index}
              key={suggestion.query}
              onClick={handleSuggestionClick}
              type="button"
            >
              <div className="bg-muted/50 text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <TrendingUp className="h-4 w-4" />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {suggestion.query}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {suggestion.count} searches
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!hasQuery && history && history.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-2.5 pt-1.5 pb-0.5">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Recent Searches
            </span>
            {onClearHistory ? (
              <Button
                className="pill-3d-hover text-muted-foreground h-auto px-2 py-0.5 text-xs"
                onClick={handleClearHistory}
                size="sm"
                variant="ghost"
              >
                Clear all
              </Button>
            ) : null}
          </div>
          {history.map((rawEntry, index) => {
            const item = normalizeHistoryItem(rawEntry);
            let removeTarget = item.raw;
            if (!removeTarget) {
              if (item.type === "query") {
                removeTarget = item.query;
              } else if (item.type === "user") {
                removeTarget = item.user.id;
              } else {
                removeTarget = item.post.id;
              }
            }

            if (item.type === "user") {
              const isSelf = Boolean(
                currentUser &&
                (item.user.id === currentUser.id ||
                  item.user.username.toLowerCase() ===
                    currentUser.username.toLowerCase())
              );
              return (
                <button
                  className={cn(ROW_CLASS, "group")}
                  data-index={index}
                  key={`history-user-${item.user.id}-${index}`}
                  onClick={() => onSelectUser(item.user)}
                  type="button"
                >
                  <UserAvatar
                    avatarUrl={item.user.avatarUrl}
                    className="h-9 w-9 shrink-0"
                    size={36}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">
                        {item.user.displayName || item.user.username}
                      </span>
                      {isSelf ? (
                        <span className="bg-primary/10 text-primary border-primary/20 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] leading-none font-semibold">
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      @{item.user.username}
                      {item.searchedAt
                        ? ` · ${formatSearchTime(item.searchedAt)}`
                        : ""}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatNumber(item.user.aura)} aura
                  </span>
                  {onRemoveHistoryItem ? (
                    <Button
                      aria-label="Remove"
                      className="text-muted-foreground my-auto h-7 w-7 shrink-0 self-center rounded-full p-0 opacity-0 transition-all duration-200 ease-out group-hover:opacity-100"
                      data-target={removeTarget}
                      onClick={handleRemoveHistoryClick}
                      size="icon"
                      variant="ghost"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </button>
              );
            }

            if (item.type === "post") {
              return (
                <button
                  className={cn(
                    ROW_CLASS,
                    "group relative max-h-23 items-start overflow-hidden py-2.5"
                  )}
                  data-index={index}
                  key={`history-post-${item.post.id}-${index}`}
                  onClick={() => onSelectPost(item.post)}
                  type="button"
                >
                  <UserAvatar
                    avatarUrl={item.post.authorAvatarUrl}
                    className="h-9 w-9 shrink-0"
                    size={36}
                  />
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="line-clamp-3 overflow-hidden text-sm leading-[1.35] font-medium [overflow-wrap:anywhere] break-words">
                      {item.post.content}
                    </span>
                    <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2.5 text-xs">
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Flame
                          className={cn(
                            "h-3 w-3",
                            item.post.aura < 0
                              ? "text-[#7c5cff]"
                              : "text-orange-500"
                          )}
                        />
                        {formatNumber(item.post.aura)}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Eye className="h-3 w-3" />
                        {formatNumber(item.post.viewCount)}
                      </span>
                      <span className="shrink-0">
                        {formatRelativeDate(item.post.createdAt)}
                      </span>
                      {item.searchedAt ? (
                        <span className="shrink-0">
                          · {formatSearchTime(item.searchedAt)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {item.post.previewMedia ? (
                    <div className="bg-muted relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                      <Image
                        alt=""
                        className={cn(
                          "h-full w-full object-cover",
                          item.post.explicitContent && "opacity-70 blur-md"
                        )}
                        fill
                        sizes="48px"
                        src={getMediaProxyUrl(item.post.previewMedia)}
                        unoptimized
                      />
                      {item.post.previewMedia.type === "VIDEO" ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow-sm">
                            <span className="ml-px h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent border-l-zinc-900" />
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {onRemoveHistoryItem ? (
                    <Button
                      aria-label="Remove"
                      className="text-muted-foreground my-auto h-7 w-7 shrink-0 self-center rounded-full p-0 opacity-0 transition-all duration-200 ease-out group-hover:opacity-100"
                      data-target={removeTarget}
                      onClick={handleRemoveHistoryClick}
                      size="icon"
                      variant="ghost"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </button>
              );
            }

            const sublineParts = [
              typeof item.resultCount === "number"
                ? `${formatNumber(item.resultCount)} results`
                : null,
              item.searchedAt ? formatSearchTime(item.searchedAt) : null,
            ].filter(Boolean);

            return (
              <button
                className={cn(ROW_CLASS, "group")}
                data-index={index}
                key={`history-query-${item.query}-${index}`}
                onClick={() => onSelectSuggestion(item.query)}
                type="button"
              >
                <div className="bg-muted/50 text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 truncate">
                  <span className="block truncate text-sm font-medium">
                    {item.query}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {sublineParts.length > 0
                      ? sublineParts.join(" · ")
                      : "Recent search"}
                  </span>
                </div>
                {onRemoveHistoryItem ? (
                  <Button
                    aria-label="Remove"
                    className="text-muted-foreground my-auto h-7 w-7 shrink-0 self-center rounded-full p-0 opacity-0 transition-all duration-200 ease-out group-hover:opacity-100"
                    data-target={removeTarget}
                    onClick={handleRemoveHistoryClick}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {hasQuery ||
      history?.length ||
      suggestions?.length ||
      hasResults ? null : (
        <div className="text-muted-foreground px-4 py-6 text-center text-sm">
          No results found.
        </div>
      )}
    </div>
  );
};
