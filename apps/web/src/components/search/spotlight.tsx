"use client";

import type { SearchPostResult, SearchUserResult } from "@asm/db";
import noSearchImage from "@assets/general/nosearch.png";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import { searchMutations } from "@/components/search/mutations";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";

interface SpotlightResponse {
  posts: SearchPostResult[];
  users: SearchUserResult[];
}

export interface SpotlightResultItem {
  avatarUrl?: string | null;
  displayName: string;
  href: string;
  icon?: React.ReactNode;
  id: string;
  meta: string;
  subtitle?: string;
  type: "user" | "post" | "history" | "suggestion";
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
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<SpotlightResultItem[]>([]);

  const { data: history } = useQuery({
    queryKey: ["spotlight-history"],
    queryFn: async () =>
      kyInstance
        .get("/api/search", { searchParams: { type: "history" } })
        .json<string[]>(),
    enabled: open,
    staleTime: 30_000,
  });

  const { data, isFetching } = useQuery({
    queryKey: ["spotlight", query],
    queryFn: () => fetchResults(query),
    enabled: open && Boolean(query.trim()),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (open) {
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
      items.push({
        type: "user",
        id: `user-${suggestion.id}`,
        displayName: suggestion.displayName || suggestion.username,
        subtitle: `@${suggestion.username}`,
        avatarUrl: suggestion.avatarUrl,
        href: `/users/${suggestion.username}`,
        meta: `${formatNumber(suggestion.aura ?? 0)} aura`,
      });
    }

    for (const post of data?.posts ?? []) {
      items.push({
        type: "post",
        id: `post-${post.id}`,
        displayName: post.content,
        subtitle: undefined,
        avatarUrl: post.authorAvatarUrl,
        href: `/posts/${post.id}`,
        meta: `${formatNumber(post.aura)} aura · ${formatNumber(post.viewCount)} views`,
      });
    }

    return items;
  }, [data]);

  const buildSuggestions = useCallback(
    (queryPrefix: string): SpotlightResultItem[] => {
      const items: SpotlightResultItem[] = [];
      const q = queryPrefix.trim();

      if (!q) {
        for (const entry of history ?? []) {
          items.push({
            type: "history",
            id: `history-${entry}`,
            displayName: entry,
            href: "",
            meta: "Recent",
          });
        }
        return items;
      }

      for (const entry of history ?? []) {
        if (entry.toLowerCase().includes(q.toLowerCase())) {
          items.push({
            type: "history",
            id: `history-${entry}`,
            displayName: entry,
            href: "",
            meta: "Recent",
          });
        }
      }

      return items;
    },
    [history]
  );

  useEffect(() => {
    resultsRef.current = buildItems();
  }, [buildItems]);

  const handleSelect = useCallback(
    (item: SpotlightResultItem) => {
      searchMutations.addSearch(item.displayName);
      onSelect(item);
      onOpenChange(false);
      if (item.href) {
        router.push(item.href);
      }
    },
    [onOpenChange, onSelect, router]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = resultsRef.current;

    if (e.key === "Escape") {
      onOpenChange(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((current) =>
        items.length ? (current + 1) % items.length : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((current) =>
        items.length ? (current - 1 + items.length) % items.length : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[activeIndex]) {
        handleSelect(items[activeIndex]);
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
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      const result = resultsRef.current[index];
      if (result) {
        handleSelect(result);
      }
    },
    [handleSelect]
  );

  const handleRowHover = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setActiveIndex(Number(e.currentTarget.dataset.index));
    },
    []
  );

  const trimmedQuery = query.trim();
  const suggestions = buildSuggestions(query);
  const items = trimmedQuery ? buildItems() : suggestions;

  const hasContent = isFetching || items.length > 0 || trimmedQuery;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleOverlayClick}
      />

      <div className="apple-panel relative w-full max-w-xl overflow-hidden rounded-2xl shadow-none">
        <div className="flex items-center gap-3 border-border/60 border-b px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search"
            className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search people and posts"
            ref={inputRef}
            type="text"
            value={query}
          />
          <kbd className="hidden shrink-0 rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground sm:block">
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
              <p className="font-medium text-sm">
                No results for &quot;{query}&quot;
              </p>
              <p className="text-muted-foreground text-xs">
                Try a different name or topic
              </p>
            </div>
          ) : null}

          {!isFetching && items.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {items.map((item, index) => (
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-all duration-200 ease-out",
                    index === activeIndex
                      ? "pill-nav-active"
                      : "pill-3d-hover text-foreground"
                  )}
                  data-index={index}
                  key={item.id}
                  onClick={handleRowClick}
                  onMouseEnter={handleRowHover}
                  type="button"
                >
                  {item.type === "user" || item.type === "post" ? (
                    <UserAvatar
                      avatarUrl={item.avatarUrl}
                      className="h-9 w-9 shrink-0"
                      size={36}
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                      {item.type === "history" ? (
                        <Clock3 className="h-4 w-4" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "font-medium text-sm",
                        item.type === "post"
                          ? "line-clamp-2 block leading-snug"
                          : "block truncate"
                      )}
                    >
                      {item.displayName}
                    </span>
                    {item.subtitle ? (
                      <span className="block truncate text-muted-foreground text-xs">
                        {item.subtitle}
                      </span>
                    ) : null}
                  </div>

                  <span className="shrink-0 text-muted-foreground text-xs">
                    {item.meta}
                  </span>
                </button>
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
              <p className="font-medium text-sm">Search Asocialmedia</p>
              <p className="text-muted-foreground text-xs">
                Start typing to find people and posts
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SpotlightSkeleton: React.FC = () => (
  <div className="flex items-center gap-3 px-2.5 py-2">
    <div className="h-9 w-9 animate-pulse rounded-lg bg-border/50" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="h-3.5 w-1/3 animate-pulse rounded-md bg-border/60" />
      <div className="h-3 w-2/3 animate-pulse rounded-md bg-border/40" />
    </div>
  </div>
);

export default Spotlight;
