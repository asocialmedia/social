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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import asmLogo from "@assets/asm.png";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { useHorizontalDragScroll } from "@/hooks/use-horizontal-drag-scroll";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import type { RecommendedAccount } from "@/lib/recommendations/suggestion-types";
import { getPostPath } from "@/lib/seo/seo";
import { profilePath } from "@/lib/users/profile-path";
import { cn, formatNumber, formatSearchTime } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

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
  { compactLabel: "Both", label: "Both networks", value: "all" },
  { compactLabel: "ASM", label: "asocialmedia", value: "asm" },
  { compactLabel: "Bluesky", label: "Bluesky", value: "bluesky" },
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

// The chosen option in the type menu wears the same raised surface as a chosen
// segment, so a choice looks identical wherever it is made.
function kindOptionSkin(active: boolean, blue: boolean) {
  if (active) {
    return blue ? "segment-3d-on-brand" : "chip-3d-raised";
  }
  return blue
    ? "text-white/85 hover:bg-white/15"
    : "text-foreground hover:bg-accent";
}

// A key in the action track. Neutral by default; when the action is carrying a
// live setting, it takes the same raised fill a chosen segment wears.
function actionSegmentSkin(active: boolean, blue: boolean) {
  if (active) {
    return blue ? "segment-3d-on-brand" : "segment-3d";
  }
  return blue
    ? "text-white/85 hover:text-white"
    : "text-muted-foreground hover:text-foreground";
}

function sourceSegmentSkin(
  active: boolean,
  source: SearchSource,
  blue: boolean
) {
  if (!active) {
    return blue
      ? "text-white/80 hover:text-white"
      : "text-muted-foreground hover:text-foreground";
  }
  if (source === "asm") {
    return "segment-3d-orange";
  }
  if (source === "bluesky") {
    return "segment-3d-bluesky";
  }
  return blue ? "segment-3d-on-brand" : "segment-3d";
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
    href: profilePath(user.username),
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

function getDialogSubtitle(source: SearchSource) {
  if (source === "bluesky") {
    return "Profiles and posts from the public network";
  }
  if (source === "asm") {
    return "People, posts, and communities on asocialmedia";
  }
  return "asocialmedia and Bluesky in one place";
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
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const canClearHistory =
    !trimmed &&
    (recent.history.length > 0 ||
      saved.history.length > 0 ||
      recent.candidates.length > 0);

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
          "[&>button:last-child]:top-4",
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
          <div className="mb-3 flex min-w-0 flex-col gap-3 lg:min-h-9 lg:flex-row lg:items-center lg:justify-between lg:pr-11">
            <div className="flex min-w-0 flex-col justify-center pr-11 lg:pr-0">
              <DialogTitle className="flex items-center gap-2 text-[15px] leading-tight font-semibold tracking-tight">
                {blue ? (
                  <BlueskyIcon className="size-5 text-white" tooltip={false} />
                ) : null}
                {getDialogTitle(source, blue)}
              </DialogTitle>
              <p
                className={cn(
                  "text-muted-foreground mt-0.5 truncate text-xs",
                  blue && "text-white/80"
                )}
              >
                {getDialogSubtitle(source)}
              </p>
            </div>

            <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5 lg:w-auto lg:justify-end">
              <fieldset
                className={cn(
                  "segmented-3d m-0 flex h-9 min-w-0 flex-1 items-center gap-0.5 rounded-xl border-0 p-1",
                  blue && "segmented-3d-on-brand"
                )}
              >
                <legend className="sr-only">Search network</legend>
                {sourceOptions.map((option) => {
                  const active = source === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={active}
                      onClick={() => changeSource(option.value)}
                      className={cn(
                        "focus-visible:ring-ring flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none sm:gap-1.5 sm:px-2.5",
                        sourceSegmentSkin(active, option.value, blue)
                      )}
                    >
                      {option.value === "asm" ? (
                        <Image
                          alt=""
                          aria-hidden
                          className={cn(
                            "size-3.5 object-contain",
                            active && "brightness-0 invert"
                          )}
                          height={14}
                          src={asmLogo}
                          width={14}
                        />
                      ) : null}
                      {option.value === "bluesky" ? (
                        <BlueskyIcon className="size-3.5" tooltip={false} />
                      ) : null}
                      <span className="sm:hidden">{option.compactLabel}</span>
                      <span className="hidden sm:inline">
                        {option.value === "all" ? "Both" : option.label}
                      </span>
                    </button>
                  );
                })}
              </fieldset>

              {/* Filters and Clear history sit in their own track, built exactly
                  like the network switcher, so the whole control bar is one
                  language: a recessed well with raised keys. */}
              <fieldset
                className={cn(
                  "segmented-3d m-0 flex h-9 shrink-0 items-center gap-0.5 rounded-xl border-0 p-1",
                  blue && "segmented-3d-on-brand"
                )}
              >
                <legend className="sr-only">Search actions</legend>
                <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Search filters"
                      className={cn(
                        "focus-visible:ring-ring flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        actionSegmentSkin(kind !== "all", blue)
                      )}
                    >
                      <SlidersHorizontal className="size-3.5" />
                      <span className="hidden sm:inline">
                        {kind === "all"
                          ? "Filters"
                          : (kindOptions.find((option) => option.value === kind)
                              ?.label ?? "Filters")}
                      </span>
                      <ChevronDown className="hidden size-3 sm:block" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={8}
                    className={cn(
                      "z-80 w-60 max-w-[calc(100vw-2rem)] p-2.5",
                      blue && "bluesky-3d-surface border-white/60"
                    )}
                    style={blue ? blueskyTheme : undefined}
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      inputRef.current?.focus();
                    }}
                  >
                    <h2
                      className={cn(
                        "text-foreground px-1 text-[13px] font-semibold",
                        blue && "text-white"
                      )}
                    >
                      Show
                    </h2>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {kindOptions
                        .filter(
                          (option) => !blue || option.value !== "community"
                        )
                        .map((option) => {
                          const active = kind === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={active}
                              onClick={() => {
                                setKind(option.value);
                                setActiveIndex(-1);
                              }}
                              className={cn(
                                "focus-visible:ring-ring flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none active:translate-y-px",
                                kindOptionSkin(active, blue)
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                {option.value === "all"
                                  ? "Everything"
                                  : option.label}
                              </span>
                              {active ? (
                                <Check
                                  className="size-3.5 shrink-0"
                                  strokeWidth={3}
                                />
                              ) : null}
                            </button>
                          );
                        })}
                    </div>
                  </PopoverContent>
                </Popover>

                {canClearHistory ? (
                  <button
                    type="button"
                    onClick={() => {
                      recent.clear();
                      if (user) {
                        saved.clearHistoryMutation.mutate();
                      }
                      setActiveIndex(-1);
                    }}
                    className={cn(
                      "focus-visible:ring-ring flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      actionSegmentSkin(false, blue)
                    )}
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only sm:not-sr-only">
                      Clear history
                    </span>
                  </button>
                ) : null}
              </fieldset>
            </div>
          </div>
          <div className="relative">
            <Search
              className={cn(
                "text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2",
                blue && "text-white/90"
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
                "focus-visible:outline-none",
                blue
                  ? "h-12 w-full min-w-0 rounded-xl border border-white/50 bg-[#0763d6] pr-11 pl-12 text-base text-white shadow-[inset_0_2px_4px_#00000026,inset_0_0_0_1px_#ffffff26,0_1px_1px_#ffffff33] transition-[box-shadow,border-color] placeholder:text-white/80 focus:border-white focus:shadow-[inset_0_2px_4px_#00000026,0_0_0_1px_#ffffff,0_0_0_4px_#ffffff59]"
                  : "premium-input h-12 w-full min-w-0 rounded-xl pr-11 pl-12 text-base"
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
                className={cn(
                  "absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full",
                  blue
                    ? "text-white/85 hover:bg-white/20 hover:text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
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

          {trimmed.length >= 2 ? (
            <div className="mt-2 flex min-h-5 items-center justify-end">
              <output
                className={cn(
                  "text-muted-foreground text-xs",
                  blue && "text-white/80"
                )}
              >
                {fetching ? "Searching…" : `${items.length} results`}
              </output>
            </div>
          ) : null}
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

          {/* Your interests. Collapsed by default: on an empty query the
              suggestions are the point, and a wall of topics pushed them below
              the fold. The trigger states what is inside and how much of it. */}
          {!trimmed && userInterests.length > 0 ? (
            <section
              aria-label="Your interests"
              className={interestsOpen ? "mb-3" : "mb-1"}
            >
              <button
                type="button"
                aria-controls="spotlight-interests"
                aria-expanded={interestsOpen}
                onClick={() => setInterestsOpen((expanded) => !expanded)}
                className={cn(
                  "focus-visible:ring-ring flex h-7 w-fit items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  blue
                    ? "text-white hover:bg-white/15"
                    : "text-foreground hover:bg-accent"
                )}
              >
                Your interests
                <span
                  className={cn(
                    "font-medium",
                    blue ? "text-white/70" : "text-muted-foreground"
                  )}
                >
                  {userInterests.length}
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                    interestsOpen && "rotate-180"
                  )}
                />
              </button>
              {interestsOpen ? (
                <div
                  id="spotlight-interests"
                  className="mt-2 flex flex-wrap gap-1.5 px-0.5"
                >
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
                        "chip-3d text-foreground hover:bg-accent/80 flex h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-colors active:translate-y-px",
                        blue && "chip-3d-on-brand hover:bg-white/20"
                      )}
                    >
                      {interest}
                    </button>
                  ))}
                </div>
              ) : null}
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
                {group.title === "Suggested accounts" ? null : (
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
                )}
                {group.title === "Suggested accounts" ? (
                  <SuggestedAccountsRail
                    activeIndex={activeIndex}
                    aside={
                      user ? "Based on your activity" : "Based on your searches"
                    }
                    blue={blue}
                    items={group.items}
                    startIndex={group.startIndex}
                    onAuthRedirect={() => onOpenChange(false)}
                    onHover={setActiveIndex}
                    onSelect={select}
                  />
                ) : (
                  <div
                    className={cn(
                      "grid gap-1",
                      group.title === "Recent" &&
                        group.items.every((item) => item.type === "user") &&
                        "sm:grid-cols-2"
                    )}
                  >
                    {group.items.map((item, rowIndex) => {
                      const index = group.startIndex + rowIndex;
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
                )}
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
          {!trimmed && items.length === 0 ? (
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

function SuggestedAccountsRail({
  items,
  startIndex,
  activeIndex,
  blue,
  aside,
  onSelect,
  onHover,
  onAuthRedirect,
}: {
  items: SpotlightResultItem[];
  startIndex: number;
  activeIndex: number;
  blue: boolean;
  aside: ReactNode;
  onSelect: (item: SpotlightResultItem) => void;
  onHover: (index: number) => void;
  onAuthRedirect: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ end: false, start: false });
  useHorizontalDragScroll(railRef);

  // The rail carries 4px of gutter, and scroll snapping can rest the first card
  // at that gutter, so the slop is wider than the padding: otherwise the rail
  // looks "already scrolled" and shows a back arrow on first paint.
  const syncEdges = useCallback(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const max = rail.scrollWidth - rail.clientWidth;
    const next = {
      end: rail.scrollLeft < max - 8,
      start: rail.scrollLeft > 8,
    };
    setEdges((previous) =>
      previous.start === next.start && previous.end === next.end
        ? previous
        : next
    );
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    syncEdges();
    const resize = new ResizeObserver(syncEdges);
    resize.observe(rail);
    const mutation = new MutationObserver(syncEdges);
    mutation.observe(rail, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [syncEdges]);

  const nudge = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    rail.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(160, rail.clientWidth * 0.8),
    });
  };

  const scrollable = edges.start || edges.end;

  return (
    <>
      <div className="mb-1.5 flex min-h-6 items-center justify-between gap-3 px-2">
        <h3 className="text-muted-foreground text-xs font-semibold">
          Suggested accounts
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-muted-foreground text-[11px]",
              blue && "text-white/75"
            )}
          >
            {aside}
          </span>
          {scrollable ? (
            // Arrows only exist while there is somewhere to go, and each one
            // disappears at the edge it would go past.
            <div className="flex items-center gap-1">
              <RailArrow
                direction="left"
                blue={blue}
                disabled={!edges.start}
                onClick={() => nudge(-1)}
              />
              <RailArrow
                direction="right"
                blue={blue}
                disabled={!edges.end}
                onClick={() => nudge(1)}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div
        ref={railRef}
        className="hide-native-scrollbar tab-strip-fade flex snap-x snap-proximity scroll-px-1 gap-2 overflow-x-auto overscroll-x-contain px-1 pt-0.5 pb-1 select-none"
        onScroll={syncEdges}
      >
        {items.map((item, rowIndex) => (
          <SuggestedAccountCard
            key={item.id}
            item={item}
            index={startIndex + rowIndex}
            active={activeIndex === startIndex + rowIndex}
            blue={blue}
            onSelect={() => onSelect(item)}
            onHover={() => onHover(startIndex + rowIndex)}
            onAuthRedirect={onAuthRedirect}
          />
        ))}
      </div>
    </>
  );
}

function RailArrow({
  direction,
  blue,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  blue: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === "left" ? "Scroll left" : "Scroll right"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "icon-btn-3d flex size-6 items-center justify-center rounded-md! transition-opacity",
        disabled ? "pointer-events-none opacity-40" : "opacity-100",
        blue && "border border-white/40 bg-[#0866df] text-white shadow-none!"
      )}
    >
      <Icon className="size-3.5" />
    </button>
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
  const account = item.recommendedAccount;
  const bannerUrl = account?.bannerUrl ?? null;
  const bio = account?.bio?.replaceAll(/\s+/g, " ").trim() || null;
  return (
    <Card
      data-suggested-account-card
      className={cn(
        "group flex w-40 flex-none snap-start flex-col overflow-hidden rounded-xl!",
        ROW_HOVER_CLASS,
        blue && "surface-3d-on-brand border-white/30 text-white",
        active && "ring-border ring-1 ring-inset",
        blue && active && "ring-white/70"
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
        className="focus-visible:ring-ring flex min-w-0 flex-1 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <SuggestedCardBanner bannerUrl={bannerUrl} seed={item.id} blue={blue} />
        <span className="relative z-10 -mt-6 flex flex-col px-3">
          <UserAvatar
            avatarUrl={item.avatarUrl}
            seed={item.id}
            size={44}
            className={cn(
              "size-11 rounded-2xl",
              // Light mode: the ring is the card's own surface, so the avatar
              // reads as cut out of the banner. On the Bluesky surface the card
              // is a translucent wash, so a ring would double the tint; a small
              // shadow separates it instead.
              blue ? "shadow-sm" : "ring-3 ring-[hsl(var(--background-alt))]"
            )}
          />
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-1 px-3">
          <span className="line-clamp-1 text-[13px] leading-4 font-semibold [overflow-wrap:anywhere]">
            {item.displayName}
          </span>
          {item.source === "bluesky" ? (
            <BlueskyIcon
              tooltip={false}
              className={cn("size-3 shrink-0", blue && "text-white")}
            />
          ) : null}
        </span>
        <span
          className={cn(
            "text-muted-foreground mt-0.5 block w-full truncate px-3 text-[11px]",
            blue && "text-white/75"
          )}
        >
          {item.subtitle}
        </span>
        <span
          className={cn(
            "text-muted-foreground mt-1.5 line-clamp-2 min-h-7 px-3 text-[11px] leading-3.5",
            blue ? "text-white/80" : "text-foreground/70"
          )}
        >
          {bio ?? item.reason ?? "Suggested for you"}
        </span>
      </button>
      <div className="mt-2 px-3 pb-3">
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

// The header image behind the avatar, held to the top half of the card. Falls
// back to a tinted wash derived from the avatar when the account has no banner,
// so every card in the row has the same silhouette instead of a ragged mix of
// image and bare surface.
function SuggestedCardBanner({
  bannerUrl,
  seed,
  blue,
}: {
  bannerUrl: string | null;
  seed: string;
  blue: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cardSurface = blue
    ? "rgba(255, 255, 255, 0.13)"
    : "hsl(var(--background-alt))";
  if (bannerUrl && !failed) {
    return (
      <span className="relative block h-14 w-full overflow-hidden">
        <Image
          alt=""
          aria-hidden
          className="object-cover"
          fill
          onError={() => setFailed(true)}
          sizes="(max-width: 640px) 45vw, 200px"
          src={getSecureImageUrl(bannerUrl)}
          unoptimized
        />
        {/* A soft bottom dissolve into the card surface, so the picture never
            ends on a hard crop line under the avatar. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-9"
          style={{
            backgroundImage: `linear-gradient(to bottom, transparent, ${cardSurface})`,
          }}
        />
      </span>
    );
  }
  const hues = [
    "from-sky-500/45 to-indigo-500/25",
    "from-orange-500/45 to-rose-500/25",
    "from-emerald-500/40 to-teal-500/20",
    "from-amber-500/45 to-orange-600/25",
  ];
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) {
    sum += seed.codePointAt(i) ?? 0;
  }
  const wash = hues[sum % hues.length];
  return (
    <span
      aria-hidden
      className={cn(
        "relative block h-14 w-full overflow-hidden bg-linear-to-br",
        wash,
        blue && "opacity-60"
      )}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-9"
        style={{
          backgroundImage: `linear-gradient(to bottom, transparent, ${cardSurface})`,
        }}
      />
    </span>
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
