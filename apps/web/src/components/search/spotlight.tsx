"use client";

import type {
  SearchHistoryItem,
  SearchCommunityResult,
  SearchPostResult,
  SearchUserResult,
} from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card } from "@asm/ui/shadui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  ArrowUpRight,
  ChevronDown,
  Clock3,
  FileText,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import CommunityAvatar from "@/components/communities/card/community-avatar";
import { ROW_HOVER_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { SuggestedFollowButton } from "@/components/recommendations/suggested-follow-button";
import {
  normalizeHistoryItem,
  useSearchHistory,
} from "@/components/search/use-search-history";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import {
  useDiscoverySuggestions,
  useSearchLearning,
} from "@/hooks/use-discovery-suggestions";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import type { RecommendedAccount } from "@/lib/recommendations/suggestion-types";
import { getPostPath } from "@/lib/seo/seo";
import { cn, formatNumber, formatSearchTime } from "@/lib/utils";

import {
  recentSearchKey,
  SearchReadError,
  suggestedResults,
} from "./spotlight-search";
import type {
  BlueskySearchResponse,
  SearchKind,
  SearchSource,
  SearchTarget,
  SpotlightResponse,
} from "./spotlight-search";
import { useRecentSearches } from "./use-recent-searches";
import { useSpotlightSearch } from "./use-spotlight-search";

export interface SpotlightResultItem {
  id: string;
  type: "user" | "post" | "community" | "history";
  source?: "asm" | "bluesky";
  displayName: string;
  href: string;
  avatarUrl?: string | null;
  subtitle?: string;
  explicitContent?: boolean;
  rawUser?: SearchUserResult;
  rawPost?: SearchPostResult;
  rawCommunity?: SearchCommunityResult;
  searchSource?: SearchSource;
  localHistoryKey?: string;
  serverRemoveTarget?: string;
  searchedAt?: number;
  reason?: string;
  recommendedAccount?: RecommendedAccount;
}

interface SpotlightProps {
  initialQuery?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: SpotlightResultItem) => void;
  open: boolean;
}

const sourceOptions = [
  { label: "Both networks", value: "all" },
  { label: "asocialmedia", value: "asm" },
  { label: "Bluesky", value: "bluesky" },
] as const;
const kindOptions = [
  { label: "Everything", value: "all" },
  { label: "Accounts", value: "user" },
  { label: "Posts", value: "post" },
  { label: "Communities", value: "community" },
] as const;

// Scoped theme tokens also travel to the portalled filter menu.
const blueskyTheme = {
  "--accent": "212 100% 60%",
  "--accent-foreground": "0 0% 100%",
  "--background-alt": "212 96% 46%",
  "--border": "0 0% 100%",
  "--color-accent": "rgba(255, 255, 255, 0.15)",
  "--color-accent-foreground": "#ffffff",
  "--color-border": "rgba(255, 255, 255, 0.4)",
  "--color-foreground": "#ffffff",
  "--color-muted": "rgba(255, 255, 255, 0.12)",
  "--color-muted-foreground": "rgba(255, 255, 255, 0.85)",
  "--color-popover-foreground": "#ffffff",
  "--color-ring": "#ffffff",
  "--foreground": "0 0% 100%",
  "--muted": "212 100% 40%",
  "--muted-foreground": "0 0% 100%",
  "--popover-foreground": "0 0% 100%",
  "--ring": "0 0% 100%",
} as CSSProperties;

function sourceLabel(source: SearchSource) {
  return (
    sourceOptions.find((option) => option.value === source)?.label ??
    "Both networks"
  );
}

function toTarget(item: SpotlightResultItem): SearchTarget | undefined {
  if (item.type === "history" || !item.source) {
    return;
  }
  return {
    avatarUrl: item.avatarUrl,
    displayName: item.displayName,
    explicitContent: item.explicitContent,
    href: item.href,
    id: item.id,
    source: item.source,
    subtitle: item.subtitle,
    type: item.type,
  };
}

function nativeUser(user: SearchUserResult): SpotlightResultItem {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName || user.username,
    href: `/users/${user.username}`,
    id: `asm-user-${user.id}`,
    rawUser: user,
    source: "asm",
    subtitle: `@${user.username}`,
    type: "user",
  };
}

function nativePost(post: SearchPostResult): SpotlightResultItem {
  return {
    avatarUrl: post.authorAvatarUrl,
    displayName: post.explicitContent
      ? "Sensitive post"
      : post.content || "Media post",
    explicitContent: post.explicitContent,
    href: getPostPath(post),
    id: `asm-post-${post.id}`,
    rawPost: post,
    source: "asm",
    subtitle: `@${post.authorUsername}`,
    type: "post",
  };
}

function serverHistoryResult(
  raw: SearchHistoryItem | string
): SpotlightResultItem {
  const entry = normalizeHistoryItem(raw);
  let item: SpotlightResultItem;
  let fallback: string;
  if (entry.type === "user") {
    item = nativeUser(entry.user);
    fallback = entry.user.id;
  } else if (entry.type === "post") {
    item = nativePost(entry.post);
    fallback = entry.post.id;
  } else {
    item = {
      displayName: entry.query,
      href: "",
      id: `query:asm:${entry.query.toLowerCase()}`,
      searchSource: "asm",
      type: "history",
    };
    fallback = entry.query;
  }
  return {
    ...item,
    searchedAt: entry.searchedAt,
    serverRemoveTarget: entry.raw || fallback,
  };
}

function resultItems(
  data: SpotlightResponse | undefined,
  external: BlueskySearchResponse | undefined
): SpotlightResultItem[] {
  return [
    ...(data?.users ?? []).map(nativeUser),
    ...(external?.profiles ?? []).map((author): SpotlightResultItem => ({
      avatarUrl: author.avatarUrl,
      displayName: author.displayName || author.handle,
      href: blueskyProfilePath(author.id),
      id: `bluesky-user-${author.id}`,
      source: "bluesky",
      subtitle: `@${author.handle}`,
      type: "user",
    })),
    ...(data?.posts ?? []).map(nativePost),
    ...(external?.posts ?? []).map((post): SpotlightResultItem => ({
      avatarUrl: post.author.avatarUrl,
      displayName: post.text || "Media post",
      href: `/network/bluesky?uri=${encodeURIComponent(post.id)}`,
      id: `bluesky-post-${post.id}`,
      source: "bluesky",
      subtitle: `@${post.author.handle}`,
      type: "post",
    })),
    ...(data?.communities ?? []).map((community): SpotlightResultItem => ({
      avatarUrl: community.avatarUrl,
      displayName: community.name,
      href: `/a/${community.slug}`,
      id: `asm-community-${community.id}`,
      rawCommunity: community,
      source: "asm",
      subtitle: `a/${community.slug} · ${formatNumber(community.memberCount)} members`,
      type: "community",
    })),
  ];
}

function networkTabClass(active: boolean, isBlue: boolean) {
  if (active) {
    return isBlue
      ? "bg-white font-semibold text-[#0763d6] shadow-sm"
      : "bg-background text-foreground shadow-sm font-semibold";
  }
  return isBlue
    ? "text-white/80 hover:text-white"
    : "text-muted-foreground hover:text-foreground";
}

function getDialogTitle(source: SearchSource, isBlue: boolean) {
  if (isBlue) {
    return "Search Bluesky";
  }
  if (source === "asm") {
    return "Search asocialmedia";
  }
  return "Search";
}

function getSearchPlaceholder(source: SearchSource, isBlue: boolean) {
  if (isBlue) {
    return "Search Bluesky accounts and posts";
  }
  if (source === "asm") {
    return "Search asocialmedia accounts, posts, communities";
  }
  return "Search accounts, posts, communities across networks";
}

export default function Spotlight({
  open,
  onOpenChange,
  onSelect,
  initialQuery,
}: SpotlightProps) {
  const router = useRouter();
  const { user } = useSession();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [source, setSource] = useState<SearchSource>("all");
  const [kind, setKind] = useState<SearchKind>("all");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recent = useRecentSearches(user?.id ?? "guest");
  const { collect } = recent;
  const saved = useSearchHistory(open);
  const network = useNetworkSettings();
  const activeProfileId = network?.settings?.preferences?.activeProfileId;
  const recommendations = useDiscoverySuggestions(
    open && Boolean(user),
    activeProfileId
  );
  const learnSearch = useSearchLearning();
  const search = useSpotlightSearch(
    query,
    source,
    user?.id ?? "guest",
    open,
    kind,
    network.scope
  );
  const trimmed = query.trim();
  const blue = source === "bluesky";
  const includesBluesky = source !== "asm" && kind !== "community";
  const native = blue ? undefined : search.asm.data;
  const external = includesBluesky ? search.bluesky.data : undefined;
  const results = useMemo(
    () =>
      resultItems(native, external).filter(
        (item) => kind === "all" || item.type === kind
      ),
    [native, external, kind]
  );
  const fetching =
    search.waiting ||
    (!blue && search.asm.isFetching) ||
    (includesBluesky && search.bluesky.isFetching);
  const errors = [
    ...(!blue && search.asm.error
      ? [{ error: search.asm.error, label: "asocialmedia" }]
      : []),
    ...(includesBluesky && search.bluesky.error
      ? [{ error: search.bluesky.error, label: "Bluesky" }]
      : []),
  ];

  const networkProfiles = network?.settings?.preferences?.profiles;
  const learnedInterests = network?.settings?.persona?.learnedInterests;
  const relatedInterests = network?.settings?.persona?.relatedInterests;
  const hasSettings = Boolean(network?.settings);

  const userInterests = useMemo(() => {
    const profileList = networkProfiles ?? [];
    const activeProfile =
      profileList.find((p) => p.id === activeProfileId) ?? profileList[0];
    const profileInterests = activeProfile?.interests ?? [];
    const learned = learnedInterests ?? [];
    const related = relatedInterests ?? [];
    const combined = [
      ...new Set([...profileInterests, ...learned, ...related]),
    ].filter(Boolean);
    if (combined.length > 0) {
      return combined.slice(0, 10);
    }
    if (hasSettings) {
      return [
        "Technology",
        "Design",
        "Music",
        "Photography",
        "Gaming",
        "Science",
      ];
    }
    return [];
  }, [
    networkProfiles,
    activeProfileId,
    learnedInterests,
    relatedInterests,
    hasSettings,
  ]);

  useEffect(() => {
    if (trimmed.length < 2 || search.waiting || results.length === 0) {
      return;
    }
    collect(
      results.flatMap((item) => {
        const target = toTarget(item);
        return target ? [target] : [];
      }),
      trimmed
    );
  }, [collect, results, trimmed, search.waiting]);

  useEffect(() => {
    if (!user || trimmed.length < 2 || fetching || !results.length) {
      return;
    }
    const timer = window.setTimeout(() => {
      void learnSearch(trimmed);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [user, trimmed, fetching, results, learnSearch]);

  const history = useMemo(() => {
    const local: SpotlightResultItem[] = recent.history.map((entry) =>
      entry.target
        ? {
            ...entry.target,
            localHistoryKey: recentSearchKey(entry),
            searchedAt: entry.searchedAt,
          }
        : {
            displayName: entry.query,
            href: "",
            id: recentSearchKey(entry),
            localHistoryKey: recentSearchKey(entry),
            searchSource: entry.source,
            searchedAt: entry.searchedAt,
            type: "history",
          }
    );
    const server = saved.history.flatMap((raw): SpotlightResultItem[] => {
      const entry = normalizeHistoryItem(raw);
      const item = serverHistoryResult(raw);
      if (
        local.some((localItem) => localItem.id === item.id) ||
        (entry.type === "query" &&
          recent.history.some(
            (localEntry) =>
              localEntry.query.toLowerCase() === entry.query.toLowerCase()
          ))
      ) {
        return [];
      }
      return [item];
    });
    return [...local, ...server]
      .filter(
        (item) =>
          (source === "all" ||
            item.source === source ||
            item.searchSource === source ||
            item.searchSource === "all") &&
          (kind === "all" || item.type === kind)
      )
      .toSorted(
        (left, right) => (right.searchedAt ?? 0) - (left.searchedAt ?? 0)
      )
      .slice(0, 10);
  }, [recent.history, saved.history, source, kind]);

  const suggested = useMemo(() => {
    if (user && !recommendations.data) {
      return [];
    }
    if (recommendations.data) {
      const accounts: SpotlightResultItem[] = recommendations.data.accounts.map(
        (account) => ({
          avatarUrl: account.avatarUrl,
          displayName: account.displayName,
          href: account.href,
          id: `${account.source}-user-${account.id}`,
          reason: account.reason,
          recommendedAccount: account,
          source: account.source,
          subtitle: `@${account.handle}`,
          type: "user",
        })
      );
      const posts: SpotlightResultItem[] = recommendations.data.posts.map(
        (post) => ({
          ...post,
          id: `${post.source}-post-${post.id}`,
          type: "post",
        })
      );
      return [...accounts, ...posts].filter(
        (item) =>
          (source === "all" || item.source === source) &&
          (kind === "all" || item.type === kind)
      );
    }
    return suggestedResults(
      recent.candidates,
      recent.history,
      source,
      kind
    ).map((entry): SpotlightResultItem => ({
      ...entry.target,
      reason: `From “${entry.query}”`,
    }));
  }, [
    user,
    recommendations.data,
    recent.candidates,
    recent.history,
    source,
    kind,
  ]);
  let groups: { title: string; items: SpotlightResultItem[] }[] = [];
  if (trimmed.length >= 2) {
    groups = [
      {
        items: results.filter((item) => item.type === "user"),
        title: "Accounts",
      },
      { items: results.filter((item) => item.type === "post"), title: "Posts" },
      {
        items: results.filter((item) => item.type === "community"),
        title: "Communities",
      },
    ];
  } else if (!trimmed) {
    groups = [
      { items: history, title: "Recent" },
      {
        items: suggested.filter((item) => item.type === "user").slice(0, 6),
        title: "Suggested accounts",
      },
      {
        items: suggested.filter((item) => item.type === "post").slice(0, 4),
        title: "Suggested posts",
      },
    ];
  }
  const items = groups.flatMap((group) => group.items);

  useEffect(() => {
    if (activeIndex >= 0) {
      listRef.current
        ?.querySelector(`[data-search-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeIndex]);

  const select = (item: SpotlightResultItem) => {
    if (item.type === "history") {
      setSource(item.searchSource ?? "all");
      setKind("all");
      setQuery(item.displayName);
      setActiveIndex(-1);
      inputRef.current?.focus();
      return;
    }
    const target = toTarget(item);
    if (target) {
      recent.rememberResult(target, trimmed);
    }
    if (user && item.source) {
      const identity =
        item.type === "user"
          ? item.id.slice(`${item.source}-user-`.length)
          : undefined;
      void learnSearch(
        trimmed || item.displayName.slice(0, 80),
        identity ? { id: identity, source: item.source } : undefined
      );
    }
    if (user && item.source === "asm") {
      if (item.rawUser) {
        saved.addUserSearchMutation.mutate(item.rawUser);
      } else if (item.rawPost) {
        saved.addPostSearchMutation.mutate(item.rawPost);
      }
    }
    onSelect(item);
    onOpenChange(false);
    router.push(item.href);
  };

  const remove = (item: SpotlightResultItem) => {
    if (item.localHistoryKey) {
      recent.remove(item.localHistoryKey);
    }
    if (user && item.source !== "bluesky") {
      const serverEntry = saved.history.find((raw) => {
        const entry = normalizeHistoryItem(raw);
        return (
          (entry.type === "user" && item.id === `asm-user-${entry.user.id}`) ||
          (entry.type === "post" && item.id === `asm-post-${entry.post.id}`) ||
          (entry.type === "query" &&
            item.type === "history" &&
            entry.query.toLowerCase() === item.displayName.toLowerCase())
        );
      });
      if (item.serverRemoveTarget || serverEntry) {
        const target =
          item.serverRemoveTarget ||
          (serverEntry
            ? serverHistoryResult(serverEntry).serverRemoveTarget
            : undefined) ||
          item.displayName;
        saved.removeHistoryItemMutation.mutate(target);
      }
    }
    setActiveIndex(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        if (!items.length) {
          return -1;
        }
        if (event.key === "ArrowDown") {
          return (current + 1) % items.length;
        }
        return (current <= 0 ? items.length : current) - 1;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected =
        items[activeIndex] ?? (trimmed.length >= 2 ? items[0] : undefined);
      if (selected) {
        select(selected);
      } else if (trimmed.length >= 2) {
        recent.remember(trimmed, source);
        if (user && !blue) {
          saved.addSearchMutation.mutate({ query: trimmed });
        }
      }
    }
  };

  const changeSource = (value: string) => {
    const next = sourceOptions.find((option) => option.value === value)?.value;
    if (next) {
      setSource(next);
      if (next === "bluesky" && kind === "community") {
        setKind("all");
      }
      setActiveIndex(-1);
    }
  };

  const indexedGroups = groups.map((group, index) => ({
    ...group,
    startIndex: groups
      .slice(0, index)
      .reduce((count, previous) => count + previous.items.length, 0),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "top-[min(6vh,3.5rem)] flex max-h-[88dvh] max-w-4xl translate-y-0 flex-col gap-0 overflow-hidden p-0 lg:max-w-5xl",
          blue &&
            "bluesky-3d-surface border-white/60 [&>button:last-child]:border [&>button:last-child]:border-white/50 [&>button:last-child]:bg-[#0763d6]! [&>button:last-child]:text-white"
        )}
        data-search-source={source}
        style={blue ? blueskyTheme : undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogDescription className="sr-only">
          Find accounts, posts, and communities across asocialmedia and Bluesky.
          Your recent searches and interests shape your suggestions.
        </DialogDescription>
        <div className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-3 pr-11">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              {blue ? (
                <BlueskyIcon className="size-5 text-white" tooltip={false} />
              ) : null}
              {getDialogTitle(source, blue)}
            </DialogTitle>

            {/* Prominent network switcher tabs */}
            <div
              className={cn(
                "flex items-center gap-1 rounded-xl p-1 text-xs",
                blue ? "bg-black/20" : "bg-muted/70"
              )}
              aria-label="Filter network"
            >
              <button
                type="button"
                aria-pressed={source === "all"}
                onClick={() => changeSource("all")}
                className={cn(
                  "rounded-lg px-3 py-1 transition-all outline-none",
                  networkTabClass(source === "all", blue)
                )}
              >
                Both
              </button>
              <button
                type="button"
                aria-pressed={source === "asm"}
                onClick={() => changeSource("asm")}
                className={cn(
                  "rounded-lg px-3 py-1 transition-all outline-none",
                  networkTabClass(source === "asm", blue)
                )}
              >
                asocialmedia
              </button>
              <button
                type="button"
                aria-pressed={source === "bluesky"}
                onClick={() => changeSource("bluesky")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1 transition-all outline-none",
                  networkTabClass(source === "bluesky", blue)
                )}
              >
                <BlueskyIcon tooltip={false} className="size-3.5" />
                Bluesky
              </button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className={cn(
                    "h-8 gap-2 rounded-full! px-3 text-xs",
                    blue &&
                      "border border-white/40 bg-white/10 text-white hover:bg-white/20"
                  )}
                  size="sm"
                  variant="ghost"
                  aria-label="Search filters"
                >
                  <SlidersHorizontal className="size-3.5" /> Filters{" "}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className={cn(
                  "z-[80] w-60",
                  blue && "bluesky-3d-surface border-white/60"
                )}
                style={blue ? blueskyTheme : undefined}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  inputRef.current?.focus();
                }}
              >
                <DropdownMenuLabel className="text-muted-foreground text-[11px]">
                  Network
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={source}
                  onValueChange={changeSource}
                  aria-label="Search network"
                >
                  {sourceOptions.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      onSelect={(event) => event.preventDefault()}
                      className="gap-2"
                    >
                      {option.value === "bluesky" ? (
                        <BlueskyIcon
                          tooltip={false}
                          className={blue ? "text-white" : undefined}
                        />
                      ) : null}
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-[11px]">
                  Show
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={kind}
                  onValueChange={(value) => {
                    const next = kindOptions.find(
                      (option) => option.value === value
                    )?.value;
                    if (next) {
                      setKind(next);
                      setActiveIndex(-1);
                    }
                  }}
                  aria-label="Result type"
                >
                  {kindOptions
                    .filter((option) => !blue || option.value !== "community")
                    .map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative">
            <Search
              className={cn(
                "text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2",
                blue && "text-white"
              )}
            />
            <input
              ref={inputRef}
              aria-label="Search"
              aria-controls="spotlight-results"
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
              value={query}
              type="text"
              placeholder={getSearchPlaceholder(source, blue)}
              className={cn(
                "premium-input h-12 w-full min-w-0 rounded-xl! pr-11 pl-12 text-base outline-none",
                blue &&
                  "border border-white/50 bg-[#0763d6]! text-white shadow-[inset_0_1px_2px_#0000001a]! placeholder:text-white/80! focus:border-white focus:shadow-[0_0_0_2px_#ffffff80]!"
              )}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={onKeyDown}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full"
                onClick={() => {
                  setQuery("");
                  setActiveIndex(-1);
                  inputRef.current?.focus();
                }}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <div className="text-muted-foreground mt-2.5 flex items-center justify-between gap-3 px-1 text-xs">
            <span>
              {sourceLabel(source)} <span className="mx-1 opacity-50">/</span>{" "}
              {kindOptions.find((option) => option.value === kind)?.label}
            </span>
            {!trimmed &&
            (recent.history.length > 0 ||
              saved.history.length > 0 ||
              recent.candidates.length > 0) ? (
              <button
                type="button"
                className="shrink-0 text-xs hover:underline"
                onClick={() => {
                  recent.clear();
                  if (user) {
                    saved.clearHistoryMutation.mutate();
                  }
                  setActiveIndex(-1);
                }}
              >
                Clear history
              </button>
            ) : null}
            {trimmed.length >= 2 ? (
              <output>
                {fetching ? "Searching…" : `${items.length} results`}
              </output>
            ) : null}
          </div>
        </div>
        <div
          id="spotlight-results"
          ref={listRef}
          className="hide-native-scrollbar border-border/60 min-h-64 overflow-x-hidden overflow-y-auto border-t px-3 py-3 sm:px-5"
        >
          {trimmed.length >= 2 &&
          (errors.length > 0 || external?.unavailable.length) ? (
            <output className="text-muted-foreground mb-3 space-y-1 px-2 text-xs">
              {errors.map(({ label, error }) => (
                <p key={label}>
                  {label}:{" "}
                  {error instanceof SearchReadError
                    ? error.message
                    : "Temporarily unavailable. Try again."}
                </p>
              ))}
              {external?.unavailable.length ? (
                <p>
                  Some Bluesky {external.unavailable.join(" and ")} are
                  temporarily unavailable.
                </p>
              ) : null}
              <Button
                variant="link"
                className="text-foreground h-auto p-0 text-xs"
                onClick={() => {
                  if (!blue) {
                    void search.asm.refetch();
                  }
                  if (includesBluesky) {
                    void search.bluesky.refetch();
                  }
                }}
              >
                Retry
              </Button>
            </output>
          ) : null}

          {/* Your interests pills shown when query is empty */}
          {!trimmed && userInterests.length > 0 ? (
            <section aria-label="Your interests" className="mb-4">
              <div className="mb-2 flex items-center justify-between px-2">
                <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="size-3.5 text-amber-500" />
                  Your interests
                </h3>
                <span className="text-muted-foreground text-[11px]">
                  Explore topics
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 px-2">
                {userInterests.map((interest) => (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => {
                      setQuery(interest);
                      setActiveIndex(-1);
                      inputRef.current?.focus();
                    }}
                    className={cn(
                      "chip-3d text-foreground hover:bg-accent/80 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      blue &&
                        "border-white/40 bg-white/10 text-white hover:bg-white/20"
                    )}
                  >
                    <span className="opacity-50">#</span>
                    <span>{interest}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {indexedGroups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section
                aria-label={group.title}
                key={group.title}
                className="mb-4 last:mb-0"
              >
                <div className="mb-1.5 flex min-h-6 items-center justify-between px-2">
                  <h3 className="text-muted-foreground text-xs font-semibold">
                    {group.title}
                  </h3>
                  {group.title.startsWith("Suggested") ? (
                    <span className="text-muted-foreground text-[11px]">
                      {user
                        ? "Based on your activity"
                        : "Based on your searches"}
                    </span>
                  ) : null}
                </div>
                <div
                  className={cn(
                    group.title === "Suggested accounts"
                      ? "flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain p-1 pb-2"
                      : "grid gap-1",
                    group.title === "Recent" &&
                      group.items.every((item) => item.type === "user") &&
                      "sm:grid-cols-2"
                  )}
                >
                  {group.items.map((item, rowIndex) => {
                    const index = group.startIndex + rowIndex;
                    if (group.title === "Suggested accounts") {
                      return (
                        <SuggestedAccountCard
                          key={item.id}
                          item={item}
                          index={index}
                          active={activeIndex === index}
                          blue={blue}
                          onSelect={() => select(item)}
                          onHover={() => setActiveIndex(index)}
                          onAuthRedirect={() => onOpenChange(false)}
                        />
                      );
                    }
                    return (
                      <SearchRow
                        key={item.id}
                        item={item}
                        index={index}
                        active={activeIndex === index}
                        blue={blue}
                        onSelect={() => select(item)}
                        onHover={() => setActiveIndex(index)}
                        onRemove={
                          group.title === "Recent"
                            ? () => remove(item)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          {trimmed.length >= 2 && fetching && items.length === 0 ? (
            <div aria-label="Loading search results" className="space-y-3 p-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="bg-muted size-10 animate-pulse rounded-xl" />
                  <div className="space-y-2">
                    <div className="bg-muted h-3 w-40 animate-pulse rounded" />
                    <div className="bg-muted h-3 w-24 animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {trimmed.length === 1 ? (
            <EmptySearch
              title="Keep typing"
              description="Enter at least two characters to search."
            />
          ) : null}
          {trimmed.length >= 2 &&
          !fetching &&
          items.length === 0 &&
          errors.length === 0 ? (
            <EmptySearch
              title={`No results for “${trimmed}”`}
              description="Try another name, topic, or network."
            />
          ) : null}
          {!trimmed && items.length === 0 && userInterests.length === 0 ? (
            <EmptySearch
              title="Find your next connection"
              description={
                kind === "all"
                  ? "The accounts and posts you open appear here. Your searches will shape suggestions along the way."
                  : "Search to find results, or choose Everything in filters to see all your recent activity."
              }
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SuggestedAccountCard({
  item,
  index,
  active,
  blue,
  onSelect,
  onHover,
  onAuthRedirect,
}: {
  item: SpotlightResultItem;
  index: number;
  active: boolean;
  blue: boolean;
  onSelect: () => void;
  onHover: () => void;
  onAuthRedirect: () => void;
}) {
  return (
    <Card
      data-suggested-account-card
      className={cn(
        "group w-40 flex-none snap-start overflow-hidden rounded-xl!",
        ROW_HOVER_CLASS,
        blue && "border-white/40 bg-white/10 text-white",
        active && "ring-border ring-1 ring-inset"
      )}
    >
      <button
        type="button"
        data-search-index={index}
        onClick={onSelect}
        onMouseEnter={onHover}
        onFocus={onHover}
        aria-label={`${item.displayName} ${item.subtitle ?? ""}`}
        title={item.displayName}
        className="focus-visible:ring-ring flex h-36 w-full flex-col items-center rounded-xl px-3 pt-4 pb-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <UserAvatar
          avatarUrl={item.avatarUrl}
          seed={item.id}
          size={48}
          className={cn("size-12", blue && "ring-1 ring-white/50")}
        />
        <span className="mt-3 flex w-full min-w-0 items-start justify-center gap-1">
          <span className="line-clamp-2 text-[13px] leading-4 font-semibold [overflow-wrap:anywhere]">
            {item.displayName}
          </span>
          {item.source === "bluesky" ? (
            <BlueskyIcon
              tooltip={false}
              className={cn(
                "mt-0.5 size-3 group-hover:text-inherit",
                blue && "text-white"
              )}
            />
          ) : null}
        </span>
        <span className="text-muted-foreground mt-1 block w-full truncate text-[11px] group-hover:text-inherit">
          {item.subtitle}
        </span>
      </button>
      <div className="px-4 pb-3">
        <SuggestedFollowButton
          onAuthRedirect={onAuthRedirect}
          account={
            item.recommendedAccount ?? {
              avatarUrl: item.avatarUrl ?? null,
              displayName: item.displayName,
              followers: 0,
              following: false,
              handle: item.subtitle?.replace(/^@/, "") ?? item.displayName,
              href: item.href,
              id: item.id.slice(`${item.source ?? "asm"}-user-`.length),
              reason: item.reason ?? "Based on your searches",
              source: item.source ?? "asm",
            }
          }
          className={blue ? "btn-3d-on-brand" : undefined}
        />
      </div>
    </Card>
  );
}

function SearchRow({
  item,
  index,
  active,
  blue,
  onSelect,
  onHover,
  onRemove,
}: {
  item: SpotlightResultItem;
  index: number;
  active: boolean;
  blue: boolean;
  onSelect: () => void;
  onHover: () => void;
  onRemove?: () => void;
}) {
  let timeLabel = "";
  if (item.searchedAt) {
    timeLabel = ` · ${formatSearchTime(item.searchedAt)}`;
  } else if (item.source === "asm") {
    timeLabel = " · ASM";
  }
  return (
    <div
      className={cn(
        "group relative flex min-w-0 items-center rounded-xl transition-colors",
        ROW_HOVER_CLASS,
        active && (blue ? "bg-white/15" : "bg-accent/70")
      )}
    >
      <button
        type="button"
        data-search-index={index}
        onClick={onSelect}
        onMouseEnter={onHover}
        onFocus={onHover}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset",
          blue ? "focus-visible:ring-white/70" : "focus-visible:ring-ring",
          onRemove && "pr-0"
        )}
      >
        <div className="relative shrink-0">
          <ResultAvatar item={item} blue={blue} />
          {item.type === "post" ? (
            <span
              className={cn(
                "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full",
                blue
                  ? "bg-[#0866df] text-white ring-1 ring-white/50"
                  : "bg-background text-muted-foreground ring-border ring-1"
              )}
            >
              <FileText className="size-2.5" />
            </span>
          ) : null}
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "text-sm font-medium",
                item.type === "post"
                  ? "line-clamp-2 leading-5 [overflow-wrap:anywhere] break-words"
                  : "truncate"
              )}
            >
              {item.displayName}
            </span>
            {item.source === "bluesky" ? (
              <BlueskyIcon
                tooltip={false}
                className={cn(
                  "size-3 group-hover:text-inherit",
                  blue && "text-white"
                )}
              />
            ) : null}
          </span>
          <span className="text-muted-foreground mt-0.5 block truncate text-xs group-hover:text-inherit">
            {item.subtitle ||
              (item.searchSource
                ? sourceLabel(item.searchSource)
                : "asocialmedia")}
            {timeLabel}
          </span>
          {item.reason ? (
            <span className="text-muted-foreground mt-0.5 block truncate text-[11px] group-hover:text-inherit">
              {item.reason}
            </span>
          ) : null}
        </span>
        {onRemove ? null : (
          <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
        )}
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${item.displayName} from history`}
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground mr-1 flex size-8 shrink-0 items-center justify-center rounded-full opacity-70 outline-none group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-inset"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ResultAvatar({
  item,
  blue,
}: {
  item: SpotlightResultItem;
  blue: boolean;
}) {
  if (item.type === "history") {
    return (
      <span
        className={cn(
          "chip-3d text-muted-foreground flex size-10 items-center justify-center rounded-xl",
          blue && "border border-white/40 bg-white/10"
        )}
      >
        <Clock3 className="size-4" />
      </span>
    );
  }
  if (item.rawCommunity) {
    return (
      <CommunityAvatar
        accentColor={item.rawCommunity.accentColor}
        avatarUrl={item.avatarUrl}
        name={item.displayName}
        slug={item.rawCommunity.slug}
        className="size-10"
      />
    );
  }
  return (
    <UserAvatar
      avatarUrl={item.avatarUrl}
      seed={item.id}
      className={cn("size-10", blue && "ring-1 ring-white/50")}
      size={40}
    />
  );
}

function EmptySearch({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex min-h-56 max-w-sm flex-col items-center justify-center px-5 py-8 text-center">
      <Search className="text-muted-foreground mb-4 size-7 stroke-[1.5]" />
      <p className="text-sm font-medium [overflow-wrap:anywhere] break-words">
        {title}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{description}</p>
    </div>
  );
}
