// The row model behind the native Spotlight, ported from web's
// components/search/spotlight.tsx (resultItems, serverHistoryResult, the
// history merge, the suggestion mapping and the grouped sections). Free of
// React Native imports so it runs under bun:test.
import type {
  DiscoverySuggestions,
  RecommendedAccount,
} from "@asm/protocols/discovery";

import { insertionOrder } from "@/features/feed/lib/feed-types";
import { formatNumber } from "@/features/home/components/profile-utils";

import type {
  SearchCommunityResult,
  SearchPostResult,
  SearchUserResult,
  SpotlightResponse,
} from "./search-api";
import { suggestedCandidates } from "./search-candidates";
import type { SearchCandidate, SearchTarget } from "./search-candidates";
import type { SearchHistoryItem } from "./search-history";
import type { SearchKind, SearchSource } from "./search-scope";

export interface SpotlightResultItem {
  avatarUrl?: string | null;
  displayName: string;
  explicitContent?: boolean;
  href: string;
  id: string;
  // The `at` stamp of the on-device recent entry this row came from.
  localHistoryAt?: number;
  rawCommunity?: SearchCommunityResult;
  rawPost?: SearchPostResult;
  rawUser?: SearchUserResult;
  reason?: string;
  recommendedAccount?: RecommendedAccount;
  searchSource?: SearchSource;
  searchedAt?: number;
  serverRemoveTarget?: string;
  source?: "asm" | "bluesky";
  subtitle?: string;
  type: "user" | "post" | "community" | "history";
}

export interface SpotlightGroup {
  items: SpotlightResultItem[];
  title:
    | "Accounts"
    | "Posts"
    | "Communities"
    | "Recent"
    | "Suggested accounts"
    | "Suggested posts";
}

// The on-device recent entry, structurally matching the stored schema in
// state/use-recent-network-searches.ts.
export interface LocalRecentSearch {
  at: number;
  avatarUrl?: string | null;
  explicit?: boolean;
  href?: string;
  id?: string;
  kind: SearchKind;
  label?: string;
  query: string;
  source: SearchSource;
  subtitle?: string;
  type?: "user" | "post" | "community";
}

export interface ServerHistoryEntry {
  item: SearchHistoryItem;
  key: string;
}

interface BlueskyProfile {
  avatarUrl?: string;
  displayName: string;
  handle: string;
  id: string;
}

interface BlueskyPost {
  author: { avatarUrl?: string; handle: string };
  id: string;
  text: string;
}

export interface BlueskyResults {
  posts: BlueskyPost[];
  profiles: BlueskyProfile[];
}

export function nativeUserItem(user: SearchUserResult): SpotlightResultItem {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName || user.username,
    href: `/users/${encodeURIComponent(user.username)}`,
    id: `asm-user-${user.id}`,
    rawUser: user,
    source: "asm",
    subtitle: `@${user.username}`,
    type: "user",
  };
}

export function nativePostItem(post: SearchPostResult): SpotlightResultItem {
  return {
    avatarUrl: post.authorAvatarUrl,
    displayName: post.explicitContent
      ? "Sensitive post"
      : post.content || "Media post",
    explicitContent: post.explicitContent,
    href: post.isGust
      ? `/gusts?${new URLSearchParams({ id: post.id })}`
      : `/posts/${encodeURIComponent(post.id)}`,
    id: `asm-post-${post.id}`,
    rawPost: post,
    source: "asm",
    subtitle: `@${post.authorUsername}`,
    type: "post",
  };
}

export function communityItem(
  community: SearchCommunityResult
): SpotlightResultItem {
  return {
    avatarUrl: community.avatarUrl,
    displayName: community.name,
    href: `/a/${encodeURIComponent(community.slug)}`,
    id: `asm-community-${community.id}`,
    rawCommunity: community,
    source: "asm",
    subtitle: `a/${community.slug} · ${formatNumber(community.memberCount)} members`,
    type: "community",
  };
}

export function blueskyProfileItem(
  author: BlueskyProfile
): SpotlightResultItem {
  return {
    avatarUrl: author.avatarUrl,
    displayName: author.displayName || author.handle,
    href: `/network/bluesky/profile?${new URLSearchParams({ actor: author.id })}`,
    id: `bluesky-user-${author.id}`,
    source: "bluesky",
    subtitle: `@${author.handle}`,
    type: "user",
  };
}

export function blueskyPostItem(post: BlueskyPost): SpotlightResultItem {
  return {
    avatarUrl: post.author.avatarUrl,
    displayName: post.text || "Media post",
    href: `/network/bluesky?${new URLSearchParams({ uri: post.id })}`,
    id: `bluesky-post-${post.id}`,
    source: "bluesky",
    subtitle: `@${post.author.handle}`,
    type: "post",
  };
}

// Web's resultItems: ASM accounts, Bluesky profiles, ASM posts, Bluesky posts,
// then communities, narrowed to the chosen kind.
export function spotlightResultItems(
  asm: SpotlightResponse | undefined,
  bluesky: BlueskyResults | undefined,
  kind: SearchKind
): SpotlightResultItem[] {
  return [
    ...(asm?.users ?? []).map(nativeUserItem),
    ...(bluesky?.profiles ?? []).map(blueskyProfileItem),
    ...(asm?.posts ?? []).map(nativePostItem),
    ...(bluesky?.posts ?? []).map(blueskyPostItem),
    ...(asm?.communities ?? []).map(communityItem),
  ].filter((item) => kind === "all" || item.type === kind);
}

export function groupSpotlightResults(
  items: SpotlightResultItem[]
): SpotlightGroup[] {
  return [
    { items: items.filter((item) => item.type === "user"), title: "Accounts" },
    { items: items.filter((item) => item.type === "post"), title: "Posts" },
    {
      items: items.filter((item) => item.type === "community"),
      title: "Communities",
    },
  ];
}

// A result reduced to what the recent list and guest suggestions store.
export function spotlightTarget(
  item: SpotlightResultItem
): SearchTarget | undefined {
  if (item.type === "history" || !item.source) {
    return;
  }
  return {
    avatarUrl: item.avatarUrl ?? null,
    displayName: item.displayName.slice(0, 280),
    explicitContent: item.explicitContent,
    href: item.href,
    id: item.id,
    source: item.source,
    subtitle: item.subtitle?.slice(0, 160),
    type: item.type,
  };
}

export function serverHistoryItem({
  item,
  key,
}: ServerHistoryEntry): SpotlightResultItem {
  let row: SpotlightResultItem;
  if (item.type === "user") {
    row = nativeUserItem({
      aura: item.user.aura ?? 0,
      avatarUrl: item.user.avatarUrl ?? null,
      badge: null,
      badges: [],
      bio: null,
      displayName: item.user.displayName || item.user.username,
      id: item.user.id,
      username: item.user.username,
    });
  } else if (item.type === "post") {
    row = nativePostItem({
      aura: item.post.aura ?? 0,
      authorAvatarUrl: item.post.authorAvatarUrl ?? null,
      authorDisplayName: "",
      authorUsername: item.post.authorUsername ?? "someone",
      content: item.post.content,
      createdAt: item.post.createdAt,
      explicitContent: item.post.explicitContent ?? false,
      id: item.post.id,
      isGust: false,
      previewMedia: item.post.previewMedia ?? null,
      viewCount: item.post.viewCount ?? 0,
    });
  } else {
    row = {
      displayName: item.query,
      href: "",
      id: `query:asm:${item.query.toLowerCase()}`,
      searchSource: "asm",
      type: "history",
    };
  }
  return { ...row, searchedAt: item.searchedAt, serverRemoveTarget: key };
}

// Entries written before targets carried a type are classified by route.
function targetTypeOf(href: string): "user" | "post" | "community" {
  if (href.startsWith("/a/")) {
    return "community";
  }
  if (
    href.startsWith("/users/") ||
    href.startsWith("/network/bluesky/profile")
  ) {
    return "user";
  }
  return "post";
}

export function localRecentItem(entry: LocalRecentSearch): SpotlightResultItem {
  if (!entry.href) {
    const id = `query:${entry.source}:${entry.query.toLowerCase()}`;
    return {
      displayName: entry.query,
      href: "",
      id,
      localHistoryAt: entry.at,
      searchSource: entry.source,
      searchedAt: entry.at,
      type: "history",
    };
  }
  let source: "asm" | "bluesky" = "asm";
  if (entry.source === "bluesky" || entry.href.startsWith("/network/bluesky")) {
    source = "bluesky";
  }
  return {
    avatarUrl: entry.avatarUrl,
    displayName: entry.label ?? entry.query,
    explicitContent: entry.explicit,
    href: entry.href,
    id: entry.id ?? `local:${entry.href}`,
    localHistoryAt: entry.at,
    searchedAt: entry.at,
    source,
    subtitle: entry.subtitle,
    type: entry.type ?? targetTypeOf(entry.href),
  };
}

// Web's history memo: on-device entries plus server entries the device does
// not already hold, filtered to the active network and kind, newest first,
// capped at ten.
export function mergeRecentHistory(
  local: LocalRecentSearch[],
  server: ServerHistoryEntry[],
  source: SearchSource,
  kind: SearchKind
): SpotlightResultItem[] {
  const localItems = local.map(localRecentItem);
  const localIds = new Set(localItems.map((item) => item.id));
  const localQueries = new Set(local.map((entry) => entry.query.toLowerCase()));
  const serverItems = server.flatMap((entry) => {
    const item = serverHistoryItem(entry);
    if (
      localIds.has(item.id) ||
      (entry.item.type === "query" &&
        localQueries.has(entry.item.query.toLowerCase()))
    ) {
      return [];
    }
    return [item];
  });
  const visible = [...localItems, ...serverItems].filter(
    (item) =>
      (source === "all" ||
        item.source === source ||
        item.searchSource === source ||
        item.searchSource === "all") &&
      (kind === "all" || item.type === kind)
  );
  // insertionOrder instead of toSorted: Hermes builds lack toSorted.
  return insertionOrder(
    visible,
    (left, right) => (right.searchedAt ?? 0) - (left.searchedAt ?? 0)
  ).slice(0, 10);
}

// The server entry a recent row should also delete, matched the way web's
// remove() does when the row itself came from the device.
export function matchingServerEntry(
  item: SpotlightResultItem,
  server: ServerHistoryEntry[]
): ServerHistoryEntry | undefined {
  return server.find(
    ({ item: entry }) =>
      (entry.type === "user" && item.id === `asm-user-${entry.user.id}`) ||
      (entry.type === "post" && item.id === `asm-post-${entry.post.id}`) ||
      (entry.type === "query" &&
        item.type === "history" &&
        entry.query.toLowerCase() === item.displayName.toLowerCase())
  );
}

// ASM suggestion hrefs use web's vanity `/<username>` path, which the native
// router has no screen for, so ASM accounts route through /users/.
function recommendedAccountHref(account: RecommendedAccount) {
  return account.source === "asm"
    ? `/users/${encodeURIComponent(account.handle)}`
    : account.href;
}

// Web's suggested memo. Signed-in viewers get server suggestions; guests get
// the results their own searches surfaced but they did not open.
export function suggestedItems({
  candidates,
  data,
  kind,
  local,
  signedIn,
  source,
  now = Date.now(),
}: {
  candidates: SearchCandidate[];
  data: DiscoverySuggestions | undefined;
  kind: SearchKind;
  local: LocalRecentSearch[];
  signedIn: boolean;
  source: SearchSource;
  now?: number;
}): SpotlightResultItem[] {
  if (signedIn) {
    if (!data) {
      return [];
    }
    const accounts = data.accounts.map((account): SpotlightResultItem => ({
      avatarUrl: account.avatarUrl,
      displayName: account.displayName,
      href: recommendedAccountHref(account),
      id: `${account.source}-user-${account.id}`,
      reason: account.reason,
      recommendedAccount: account,
      source: account.source,
      subtitle: `@${account.handle}`,
      type: "user",
    }));
    const posts = data.posts.map((post): SpotlightResultItem => ({
      avatarUrl: post.avatarUrl,
      displayName: post.displayName,
      // Web's ASM post href carries an 8-character id prefix, which 404s
      // natively when it matches more than one post; the full id never does.
      href:
        post.source === "asm"
          ? `/posts/${encodeURIComponent(post.id)}`
          : post.href,
      id: `${post.source}-post-${post.id}`,
      reason: post.reason,
      source: post.source,
      subtitle: post.subtitle,
      type: "post",
    }));
    return [...accounts, ...posts].filter(
      (item) =>
        (source === "all" || item.source === source) &&
        (kind === "all" || item.type === kind)
    );
  }
  const opened = new Set(
    local.flatMap((entry) => (entry.id ? [entry.id] : []))
  );
  return suggestedCandidates(candidates, opened, source, kind, now).map(
    (entry): SpotlightResultItem => ({
      ...entry.target,
      reason: `From “${entry.query}”`,
    })
  );
}

// Web's empty-query and query section lists.
export function spotlightGroups(
  trimmed: string,
  results: SpotlightResultItem[],
  history: SpotlightResultItem[],
  suggested: SpotlightResultItem[]
): SpotlightGroup[] {
  if (trimmed.length >= 2) {
    return groupSpotlightResults(results);
  }
  if (trimmed) {
    return [];
  }
  return [
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

const FALLBACK_INTERESTS = [
  "Technology",
  "Design",
  "Music",
  "Photography",
  "Gaming",
  "Science",
];

// Web's userInterests: the active profile's topics, then learned and related
// interests, de-duplicated and capped at ten, with a starter set when empty.
export function spotlightInterests(settings: {
  persona: { learnedInterests: string[]; relatedInterests: string[] };
  preferences: {
    activeProfileId: string;
    profiles: { id: string; interests: string[] }[];
  };
}): string[] {
  const { profiles, activeProfileId } = settings.preferences;
  const active =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const combined = [
    ...new Set([
      ...(active?.interests ?? []),
      ...settings.persona.learnedInterests,
      ...settings.persona.relatedInterests,
    ]),
  ].filter(Boolean);
  return combined.length > 0 ? combined.slice(0, 10) : FALLBACK_INTERESTS;
}

export function searchPlaceholder(source: SearchSource): string {
  if (source === "bluesky") {
    return "Search Bluesky accounts and posts";
  }
  if (source === "asm") {
    return "Search asocialmedia accounts, posts, communities";
  }
  return "Search accounts, posts, communities across networks";
}

export function searchTitle(source: SearchSource): string {
  if (source === "bluesky") {
    return "Search Bluesky";
  }
  return source === "asm" ? "Search asocialmedia" : "Search";
}

export function searchSubtitle(source: SearchSource): string {
  if (source === "bluesky") {
    return "Profiles and posts from the public network";
  }
  if (source === "asm") {
    return "People, posts, and communities on asocialmedia";
  }
  return "asocialmedia and Bluesky in one place";
}

export function sourceLabel(source: SearchSource): string {
  if (source === "asm") {
    return "asocialmedia";
  }
  return source === "bluesky" ? "Bluesky" : "Both networks";
}

// Which of web's three EmptySearch copies applies, if any.
export function emptySearchCopy({
  errorCount,
  fetching,
  itemCount,
  kind,
  trimmed,
}: {
  errorCount: number;
  fetching: boolean;
  itemCount: number;
  kind: SearchKind;
  trimmed: string;
}): { description: string; title: string } | null {
  if (trimmed.length === 1) {
    return {
      description: "Enter at least two characters to search.",
      title: "Keep typing",
    };
  }
  if (trimmed.length >= 2) {
    return !fetching && itemCount === 0 && errorCount === 0
      ? {
          description: "Try another name, topic, or network.",
          title: `No results for “${trimmed}”`,
        }
      : null;
  }
  if (itemCount > 0) {
    return null;
  }
  return {
    description:
      kind === "all"
        ? "The accounts and posts you open appear here. Your searches will shape suggestions along the way."
        : "Search to find results, or choose Everything in filters to see all your recent activity.",
    title: "Find your next connection",
  };
}
