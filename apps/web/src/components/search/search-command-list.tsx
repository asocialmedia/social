"use client";

import type { SearchPostResult, SearchUserResult } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noSearchImage from "@assets/general/nosearch.png";
import { Clock3, Eye, Flame, TrendingUp, X } from "lucide-react";
import Image from "next/image";
import { useCallback } from "react";
import type { MouseEvent } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";

interface SearchCommandListProps {
  history?: string[];
  input: string;
  onClearHistory?: () => void;
  onRemoveHistoryItem?: (query: string) => void;
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
  const handleClearHistory = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onClearHistory?.();
    },
    [onClearHistory]
  );

  const handleRemoveHistoryItem = useCallback(
    (e: MouseEvent<HTMLButtonElement>, query: string) => {
      e.preventDefault();
      e.stopPropagation();
      onRemoveHistoryItem?.(query);
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

  const handleHistoryClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      const query = history?.[index];
      if (query) {
        onSelectSuggestion(query);
      }
    },
    [history, onSelectSuggestion]
  );

  const handleRemoveHistoryClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const { query } = e.currentTarget.dataset;
      if (query) {
        handleRemoveHistoryItem(e, query);
      }
    },
    [handleRemoveHistoryItem]
  );

  const hasResults = (users && users.length > 0) || (posts && posts.length > 0);
  const hasQuery = Boolean(input.trim());

  return (
    <div className="apple-panel overflow-hidden rounded-2xl p-1.5 shadow-none">
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
          {users.map((user, index) => (
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
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {user.displayName || user.username}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  @{user.username}
                </span>
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {formatNumber(user.aura)} aura
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {posts && posts.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide uppercase">
            Posts
          </div>
          {posts.map((post, index) => (
            <button
              className={ROW_CLASS}
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
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm leading-snug font-medium">
                  {post.content}
                </span>
                <span className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
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
          {history.map((query, index) => (
            <button
              className={cn(ROW_CLASS, "group")}
              data-index={index}
              key={query}
              onClick={handleHistoryClick}
              type="button"
            >
              <div className="bg-muted/50 text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <Clock3 className="h-4 w-4" />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {query}
              </span>
              {onRemoveHistoryItem ? (
                <Button
                  aria-label="Remove"
                  className="text-muted-foreground h-7 w-7 shrink-0 rounded-full p-0 opacity-0 transition-all duration-200 ease-out group-hover:opacity-100"
                  data-query={query}
                  onClick={handleRemoveHistoryClick}
                  size="icon"
                  variant="ghost"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </button>
          ))}
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
