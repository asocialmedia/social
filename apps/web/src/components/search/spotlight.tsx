"use client";

import type { SearchPostResult, SearchUserResult } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noSearchImage from "@assets/general/nosearch.png";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Eye, Flame, Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import {
  normalizeHistoryItem,
  useSearchHistory,
} from "@/components/search/use-search-history";
import {
  cn,
  formatNumber,
  formatRelativeDate,
  formatSearchTime,
} from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface SpotlightResponse {
  posts: SearchPostResult[];
  users: SearchUserResult[];
}

export interface SpotlightResultItem {
  aura?: number;
  authorUsername?: string;
  avatarUrl?: string | null;
  createdAt?: Date;
  displayName: string;
  explicitContent?: boolean;
  href: string;
  icon?: React.ReactNode;
  id: string;
  isSelf?: boolean;
  meta: string;
  previewMedia?: {
    id: string;
    thumbnailKey: string | null;
    type: string;
  } | null;
  rawPost?: SearchPostResult;
  rawUser?: SearchUserResult;
  removeTarget?: string;
  resultCount?: number;
  searchedAt?: number;
  subtitle?: string;
  type: "user" | "post" | "history" | "suggestion";
  viewCount?: number;
}

const fetchResults = async (query: string): Promise<SpotlightResponse> => {
  const response = await fetch(
    `/api/search/spotlight?q=${encodeURIComponent(query)}`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch results");
  }
  return response.json();
};

interface SpotlightProps {
  initialQuery?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: SpotlightResultItem) => void;
  open: boolean;
}

const Spotlight: React.FC<SpotlightProps> = ({
  open,
  onOpenChange,
  onSelect,
  initialQuery,
}) => {
  const router = useRouter();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<SpotlightResultItem[]>([]);

  const {
    addPostSearchMutation,
    addSearchMutation,
    addUserSearchMutation,
    clearHistoryMutation,
    history,
    removeHistoryItemMutation,
  } = useSearchHistory();

  const { data, isFetching } = useQuery({
    enabled: open && Boolean(query.trim()),
    queryFn: () => fetchResults(query),
    queryKey: ["spotlight", query],
    staleTime: 15_000,
  });

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-compiler -- seed the search box with the requested query when opened
      setQuery(initialQuery ?? "");
      setActiveIndex(0);
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open, initialQuery]);

  const buildItems = useCallback((): SpotlightResultItem[] => {
    const items: SpotlightResultItem[] = [];

    for (const suggestion of data?.users ?? []) {
      const isSelf = Boolean(
        user &&
        (suggestion.id === user.id ||
          suggestion.username.toLowerCase() === user.username.toLowerCase())
      );
      items.push({
        avatarUrl: suggestion.avatarUrl,
        displayName: suggestion.displayName || suggestion.username,
        href: `/users/${suggestion.username}`,
        id: `user-${suggestion.id}`,
        isSelf,
        meta: `${formatNumber(suggestion.aura ?? 0)} aura`,
        rawUser: suggestion,
        subtitle: `@${suggestion.username}`,
        type: "user",
      });
    }

    for (const post of data?.posts ?? []) {
      items.push({
        aura: post.aura,
        authorUsername: post.authorUsername,
        avatarUrl: post.authorAvatarUrl,
        createdAt: post.createdAt,
        displayName: post.content,
        explicitContent: post.explicitContent,
        href: `/posts/${post.id}`,
        id: `post-${post.id}`,
        meta: `${formatNumber(post.aura)} aura · ${formatNumber(post.viewCount)} views`,
        previewMedia: post.previewMedia,
        rawPost: post,
        subtitle: undefined,
        type: "post",
        viewCount: post.viewCount,
      });
    }

    return items;
  }, [data, user]);

  const buildSuggestions = useCallback(
    (queryPrefix: string): SpotlightResultItem[] => {
      const items: SpotlightResultItem[] = [];
      const q = queryPrefix.trim().toLowerCase();

      for (const rawEntry of history ?? []) {
        const entry = normalizeHistoryItem(rawEntry);
        let removeTarget = entry.raw;
        if (entry.type === "user") {
          if (!removeTarget) {
            removeTarget = entry.user.id;
          }
          const match =
            !q ||
            entry.user.username.toLowerCase().includes(q) ||
            entry.user.displayName?.toLowerCase().includes(q);
          if (match) {
            const isSelf = Boolean(
              user &&
              (entry.user.id === user.id ||
                entry.user.username.toLowerCase() ===
                  user.username.toLowerCase())
            );
            const searchTimeStr = entry.searchedAt
              ? formatSearchTime(entry.searchedAt)
              : "";
            items.push({
              avatarUrl: entry.user.avatarUrl,
              displayName: entry.user.displayName || entry.user.username,
              href: `/users/${entry.user.username}`,
              id: `history-user-${entry.user.id}`,
              isSelf,
              meta: `${formatNumber(entry.user.aura ?? 0)} aura`,
              rawUser: entry.user,
              removeTarget,
              searchedAt: entry.searchedAt,
              subtitle: searchTimeStr
                ? `@${entry.user.username} · ${searchTimeStr}`
                : `@${entry.user.username}`,
              type: "user",
            });
          }
        } else if (entry.type === "post") {
          if (!removeTarget) {
            removeTarget = entry.post.id;
          }
          const match =
            !q ||
            entry.post.content.toLowerCase().includes(q) ||
            entry.post.authorUsername.toLowerCase().includes(q);
          if (match) {
            items.push({
              aura: entry.post.aura,
              authorUsername: entry.post.authorUsername,
              avatarUrl: entry.post.authorAvatarUrl,
              createdAt: entry.post.createdAt,
              displayName: entry.post.content,
              explicitContent: entry.post.explicitContent,
              href: `/posts/${entry.post.id}`,
              id: `history-post-${entry.post.id}`,
              meta: `${formatNumber(entry.post.aura)} aura · ${formatNumber(entry.post.viewCount)} views`,
              previewMedia: entry.post.previewMedia,
              rawPost: entry.post,
              removeTarget,
              searchedAt: entry.searchedAt,
              subtitle: undefined,
              type: "post",
              viewCount: entry.post.viewCount,
            });
          }
        } else if (entry.type === "query") {
          if (!removeTarget) {
            removeTarget = entry.query;
          }
          const match = !q || entry.query.toLowerCase().includes(q);
          if (match) {
            const metaParts = [
              typeof entry.resultCount === "number"
                ? `${formatNumber(entry.resultCount)} results`
                : null,
              entry.searchedAt
                ? formatSearchTime(entry.searchedAt)
                : "Recent search",
            ].filter(Boolean);

            items.push({
              displayName: entry.query,
              href: "",
              id: `history-query-${entry.query}`,
              meta: metaParts.join(" · "),
              removeTarget,
              resultCount: entry.resultCount,
              searchedAt: entry.searchedAt,
              type: "history",
            });
          }
        }
      }

      return items;
    },
    [history, user]
  );

  const trimmedQuery = query.trim();
  const suggestions = buildSuggestions(query);
  const items = trimmedQuery ? buildItems() : suggestions;

  useEffect(() => {
    resultsRef.current = items;
  }, [items]);

  const handleSelect = useCallback(
    (item: SpotlightResultItem) => {
      if (item.type === "history") {
        setQuery(item.displayName);
        return;
      }
      if (item.type === "user" && item.rawUser) {
        addUserSearchMutation.mutate(item.rawUser);
      } else if (item.type === "post" && item.rawPost) {
        addPostSearchMutation.mutate(item.rawPost);
      } else {
        const resultCount = data
          ? data.users.length + data.posts.length
          : undefined;
        addSearchMutation.mutate({ query: item.displayName, resultCount });
      }
      onSelect(item);
      onOpenChange(false);
      if (item.href) {
        router.push(item.href);
      }
    },
    [
      addPostSearchMutation,
      addSearchMutation,
      addUserSearchMutation,
      data,
      onOpenChange,
      onSelect,
      router,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const activeItems = resultsRef.current;

    if (e.key === "Escape") {
      onOpenChange(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((current) =>
        activeItems.length ? (current + 1) % activeItems.length : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((current) =>
        activeItems.length
          ? (current - 1 + activeItems.length) % activeItems.length
          : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeItems[activeIndex]) {
        handleSelect(activeItems[activeIndex]);
      } else if (trimmedQuery) {
        const resultCount = data
          ? data.users.length + data.posts.length
          : undefined;
        addSearchMutation.mutate({ query: trimmedQuery, resultCount });
      }
    }
  };

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setActiveIndex(0);
    },
    []
  );

  const handleOverlayClick = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      const result = resultsRef.current[index];
      if (result) {
        handleSelect(result);
      }
    },
    [handleSelect]
  );

  const handleRowHover = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setActiveIndex(Number(e.currentTarget.dataset.index));
  }, []);

  const hasContent = isFetching || items.length > 0 || trimmedQuery;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleOverlayClick}
      />

      <div className="apple-panel relative w-full max-w-xl overflow-hidden rounded-2xl shadow-none">
        <div className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
          <Search className="text-muted-foreground h-5 w-5 shrink-0" />
          <input
            aria-label="Search"
            className="placeholder:text-muted-foreground w-full bg-transparent text-base outline-none"
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search people and posts"
            ref={inputRef}
            type="text"
            value={query}
          />
          <kbd className="border-border/60 bg-muted/50 text-muted-foreground hidden shrink-0 rounded-md border px-1.5 py-0.5 font-sans text-[10px] sm:block">
            esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5" ref={listRef}>
          {isFetching && trimmedQuery ? (
            <div className="flex flex-col gap-0.5">
              <SpotlightSkeleton />
              <SpotlightSkeleton />
              <SpotlightSkeleton />
            </div>
          ) : null}

          {!isFetching && trimmedQuery && items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <Image
                alt=""
                className="h-24 w-auto object-contain"
                draggable={false}
                height={128}
                src={noSearchImage}
                width={128}
              />
              <p className="text-sm font-medium">
                No results for &quot;{query}&quot;
              </p>
              <p className="text-muted-foreground text-xs">
                Try a different name or topic
              </p>
            </div>
          ) : null}

          {!isFetching && items.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {!trimmedQuery && history && history.length > 0 ? (
                <div className="flex items-center justify-between px-2.5 pt-1 pb-0.5">
                  <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Recent searches
                  </span>
                  <Button
                    className="pill-3d-hover text-muted-foreground h-auto px-2 py-0.5 text-xs"
                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      clearHistoryMutation.mutate();
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Clear all
                  </Button>
                </div>
              ) : null}
              {items.map((item, index) => (
                <div
                  className={cn(
                    "group relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all duration-200 ease-out outline-none",
                    item.type === "post"
                      ? "max-h-[88px] overflow-hidden py-2"
                      : "",
                    index === activeIndex
                      ? "pill-nav-active"
                      : "pill-3d-hover text-foreground"
                  )}
                  data-index={index}
                  key={item.id}
                  onClick={handleRowClick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(item);
                    }
                  }}
                  onMouseEnter={handleRowHover}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- row contains a remove history button; nesting buttons is invalid HTML
                  role="button"
                  tabIndex={0}
                >
                  {item.type === "user" || item.type === "post" ? (
                    <UserAvatar
                      avatarUrl={item.avatarUrl}
                      className="h-9 w-9 shrink-0"
                      size={36}
                    />
                  ) : (
                    <div className="bg-muted/50 text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                      {item.type === "history" ? (
                        <Clock3 className="h-4 w-4" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </div>
                  )}

                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          item.type === "post"
                            ? "line-clamp-3 overflow-hidden leading-[1.35] [overflow-wrap:anywhere] break-words"
                            : "block truncate"
                        )}
                      >
                        {item.displayName}
                      </span>
                      {item.isSelf ? (
                        <span className="bg-primary/10 text-primary border-primary/20 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] leading-none font-semibold">
                          You
                        </span>
                      ) : null}
                    </div>
                    {item.type === "post" ? (
                      <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                        {item.authorUsername ? (
                          <span className="min-w-0 truncate">
                            @{item.authorUsername}
                          </span>
                        ) : null}
                        {typeof item.aura === "number" ? (
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <Flame
                              className={cn(
                                "h-3 w-3",
                                (item.aura ?? 0) < 0
                                  ? "text-[#7c5cff]"
                                  : "text-orange-500"
                              )}
                            />
                            {formatNumber(item.aura ?? 0)}
                          </span>
                        ) : null}
                        {typeof item.viewCount === "number" ? (
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {formatNumber(item.viewCount ?? 0)}
                          </span>
                        ) : null}
                        {item.createdAt ? (
                          <span className="shrink-0">
                            {formatRelativeDate(item.createdAt)}
                          </span>
                        ) : null}
                        {item.searchedAt ? (
                          <span className="shrink-0">
                            · {formatSearchTime(item.searchedAt)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {item.type !== "post" && item.subtitle ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {item.subtitle}
                      </span>
                    ) : null}
                  </div>

                  {item.type === "post" && item.previewMedia ? (
                    <div className="bg-muted relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                      <Image
                        alt=""
                        className={cn(
                          "h-full w-full object-cover",
                          item.explicitContent && "opacity-70 blur-md"
                        )}
                        fill
                        sizes="48px"
                        src={getMediaProxyUrl(item.previewMedia)}
                        unoptimized
                      />
                      {item.previewMedia.type === "VIDEO" ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow-sm">
                            <span className="ml-px h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent border-l-zinc-900" />
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {item.type === "post" ? null : (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {item.meta}
                    </span>
                  )}

                  {item.removeTarget ? (
                    <Button
                      aria-label="Remove"
                      className="text-muted-foreground hover:text-foreground hover:bg-muted my-auto h-7 w-7 shrink-0 self-center rounded-full p-0 opacity-0 transition-all duration-200 ease-out group-focus-within:opacity-100 group-hover:opacity-100"
                      onClick={(e: MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (item.removeTarget) {
                          removeHistoryItemMutation.mutate(item.removeTarget);
                        }
                      }}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {hasContent || isFetching || trimmedQuery ? null : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <Image
                alt=""
                className="h-28 w-auto object-contain"
                draggable={false}
                height={144}
                src={noSearchImage}
                width={144}
              />
              <p className="text-sm font-medium">Search asocialmedia</p>
              <p className="text-muted-foreground text-xs">
                Start typing to find people and posts
              </p>
            </div>
          )}
        </div>

        {isLoggedIn ? null : (
          <div className="border-border/60 flex items-center justify-between gap-2 border-t px-4 py-2.5">
            <p className="text-muted-foreground text-xs">
              Search is limited for guests. Log in for the full experience.
            </p>
            <Link
              className="text-primary text-xs font-semibold hover:underline"
              href="/login"
            >
              Log in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

const SpotlightSkeleton: React.FC = () => (
  <div className="flex items-center gap-3 px-2.5 py-2">
    <div className="bg-border/50 h-9 w-9 animate-pulse rounded-lg" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="bg-border/60 h-3.5 w-1/3 animate-pulse rounded-md" />
      <div className="bg-border/40 h-3 w-2/3 animate-pulse rounded-md" />
    </div>
  </div>
);

export default Spotlight;
