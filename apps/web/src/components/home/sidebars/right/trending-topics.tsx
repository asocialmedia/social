"use client";

import { Button } from "@asm/ui/shadui/button";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Hash, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { CARD_QUERY_POLICY } from "@/lib/cards/query-policy";
import { cn, formatNumber, truncateUsername } from "@/lib/utils";

import { APPLE_CARD_CLASS, ROW_HOVER_CLASS } from "./sidebar-styles";
import type {
  TrendingBlueskyTopic,
  TrendingFeed,
  TrendingItem,
} from "./trending-actions";
import {
  filterTrendingForInterests,
  mergeTrendingFeed,
} from "./trending-utils";

// The sidebar rail is fixed-width, and a valid username can be 50 characters, so
// the handle is clipped to a length that keeps the aura figure beside it on one
// line. A `min-w-0 truncate` wrapper below is the responsive backstop.
const TOP_AURA_USERNAME_MAX_LENGTH = 18;

async function readTrending(
  profile: string,
  refresh = false
): Promise<TrendingFeed> {
  const query = new URLSearchParams({ profile });
  if (refresh) {
    query.set("refresh", "1");
  }
  const response = await fetch(`/api/recommendations/trending?${query}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error("Couldn't load trending topics");
  }
  return response.json();
}

function getBlueskyTopicHref(item: TrendingBlueskyTopic): string {
  if (!item.link) {
    return `https://bsky.app/search?q=${encodeURIComponent(item.topic)}`;
  }
  if (item.link.startsWith("http://") || item.link.startsWith("https://")) {
    return item.link;
  }
  const normalizedPath = item.link.startsWith("/")
    ? item.link
    : `/${item.link}`;
  return `https://bsky.app${normalizedPath}`;
}

function getTrendingItemKey(item: TrendingItem): string {
  if (item.type === "hashtag") {
    return item.hashtag;
  }
  if (item.type === "bluesky_topic") {
    return `bsky-${item.topic}`;
  }
  return item.userId;
}

const TrendingTopicsSkeleton = () => (
  <div className={APPLE_CARD_CLASS}>
    <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
      <div className="bg-muted h-4 w-4 animate-pulse rounded-md" />
      <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
    </div>
    <div className="flex flex-col gap-0.5">
      {[1, 2, 3, 4, 5].map((index) => (
        <div
          className="flex animate-pulse items-center gap-2.5 rounded-lg px-2.5 py-2"
          key={`trending-skeleton-${index}`}
        >
          <div className="bg-muted h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="bg-muted h-3.5 w-3/4 rounded-md" />
            <div className="bg-muted h-3 w-1/3 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

interface TrendingRowProps {
  item: TrendingItem;
}

const TrendingRow: React.FC<TrendingRowProps> = ({ item }) => {
  if (item.type === "hashtag") {
    return (
      <Link
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
          ROW_HOVER_CLASS
        )}
        href={`/hashtag/${encodeURIComponent(item.hashtag.slice(1))}`}
      >
        <span className="border-border/60 bg-muted/50 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors group-hover:text-inherit">
          <Hash className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block min-w-0 flex-1 truncate text-sm font-medium">
            {item.hashtag}
          </span>
          <span className="text-muted-foreground block text-xs transition-colors group-hover:text-inherit">
            {formatNumber(item.count)} {item.count === 1 ? "post" : "posts"}
          </span>
        </span>
      </Link>
    );
  }

  if (item.type === "bluesky_topic") {
    const href = getBlueskyTopicHref(item);

    return (
      <a
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
          ROW_HOVER_CLASS
        )}
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-500 transition-colors group-hover:bg-sky-500/20">
          <BlueskyIcon className="size-4 text-sky-500" tooltip={false} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block min-w-0 truncate text-sm font-medium">
              {item.displayName || item.topic}
            </span>
            <BlueskyIcon
              className="size-3.5 shrink-0 text-sky-500"
              tooltip={false}
            />
          </span>
          <span className="text-muted-foreground block truncate text-xs transition-colors group-hover:text-inherit">
            {item.description || "Trending on Bluesky"}
          </span>
        </span>
      </a>
    );
  }

  return (
    <Link
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
        ROW_HOVER_CLASS
      )}
      href={`/users/${item.username}`}
    >
      <UserAvatar avatarUrl={item.avatarUrl} className="h-8 w-8 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="block min-w-0 flex-1 truncate text-sm font-medium">
            {item.displayName || `@${item.username}`}
          </span>
          <UserBadge
            badge={item.badge}
            badges={item.badges}
            className="shrink-0"
            communityRoles={item.communityMemberships}
          />
        </span>
        <span className="text-muted-foreground block truncate text-xs transition-colors group-hover:text-inherit">
          @{item.username} · {formatNumber(item.count)}{" "}
          {item.count === 1 ? "mention" : "mentions"}
        </span>
      </span>
    </Link>
  );
};

const TrendingTopics: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const network = useNetworkSettings();
  const isLoggedIn = Boolean(user);
  const profileId = network.settings.preferences.activeProfileId;
  const queryKey = ["trending-feed", "v5", user?.id ?? "guest", network.scope];
  const { data, isError, isFetching, isLoading } = useQuery<TrendingFeed>({
    enabled: network.ready,
    queryFn: async () =>
      mergeTrendingFeed(
        queryClient.getQueryData<TrendingFeed>(queryKey),
        await readTrending(profileId)
      ),
    queryKey,
    ...CARD_QUERY_POLICY,
  });

  const selected = network.settings.preferences.profiles.find(
    (profile) => profile.id === network.settings.preferences.activeProfileId
  );
  const items = filterTrendingForInterests(
    data?.items ?? [],
    selected?.interests.length
      ? selected.interests
      : network.settings.persona.learnedInterests,
    network.settings.preferences.avoidedTopics,
    network.settings.topicScope
  );
  const topAura = data?.topAura ?? [];

  const refresh = useMutation({
    mutationFn: (variables: { profile: string; key: string[] }) =>
      readTrending(variables.profile, true),
    onSuccess: (fresh, variables) =>
      queryClient.setQueryData<TrendingFeed>(variables.key, (previous) =>
        mergeTrendingFeed(previous, fresh)
      ),
  });
  const refreshing = isFetching || refresh.isPending;
  const failedToLoad = !data && isError;
  const handleRefresh = () =>
    refresh.mutate({ key: queryKey, profile: profileId });

  if (isLoading || !network.ready) {
    return <TrendingTopicsSkeleton />;
  }

  return (
    <div className={APPLE_CARD_CLASS}>
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
        <TrendingUp className="text-muted-foreground h-4 w-4 shrink-0" />
        <h2 className="text-sm font-semibold">Trending</h2>
        {isLoggedIn ? (
          <Button
            aria-label="Refresh trending"
            className="pill-3d-hover text-muted-foreground ml-auto h-6 w-6 rounded-full"
            disabled={refreshing}
            onClick={handleRefresh}
            size="icon"
            variant="ghost"
          >
            {refreshing ? (
              <Skeleton className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        ) : null}
      </div>
      {failedToLoad ? (
        <div className="px-2.5 py-2">
          <p className="text-muted-foreground text-sm">
            Couldn&apos;t load trending topics right now.
          </p>
          <Button
            className="pill-3d-hover text-muted-foreground mt-2 h-7 rounded-full px-3 text-xs"
            disabled={refreshing}
            onClick={handleRefresh}
            variant="ghost"
          >
            {refreshing ? (
              <Skeleton className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Retry
          </Button>
        </div>
      ) : null}
      {data && (isError || refresh.isError || data.unavailable.length > 0) ? (
        <output className="text-muted-foreground block px-2.5 py-2 text-xs">
          Some sources couldn&apos;t refresh. Keeping their last loaded results.
        </output>
      ) : null}
      {!failedToLoad && items.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {items.slice(0, 7).map((item) => (
            <TrendingRow item={item} key={getTrendingItemKey(item)} />
          ))}
        </div>
      ) : null}
      {!failedToLoad && items.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm">
          {data?.items.length
            ? "No trending topics match your current interests yet."
            : "No trending topics are available right now."}
        </p>
      ) : null}
      {!failedToLoad && topAura.length > 0 ? (
        <>
          <div className="border-border/60 mt-2 flex items-center gap-2 border-t px-2 pt-2 pb-1">
            <Flame className="h-4 w-4 shrink-0 fill-red-500 text-red-500" />
            <h3 className="text-sm font-semibold">Top Aura</h3>
          </div>
          <div className="flex flex-col gap-0.5">
            {topAura.map((auraUser) => (
              <Link
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
                  ROW_HOVER_CLASS
                )}
                href={`/users/${auraUser.username}`}
                key={auraUser.userId}
              >
                <UserAvatar
                  avatarUrl={auraUser.avatarUrl}
                  className="h-8 w-8 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="block min-w-0 flex-1 truncate text-sm font-medium">
                      {auraUser.displayName ||
                        `@${truncateUsername(auraUser.username, TOP_AURA_USERNAME_MAX_LENGTH)}`}
                    </span>
                    <UserBadge
                      badge={auraUser.badge}
                      badges={auraUser.badges}
                      className="shrink-0"
                      communityRoles={auraUser.communityMemberships}
                    />
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1 text-xs transition-colors group-hover:text-inherit">
                    <span className="min-w-0 truncate">
                      @
                      {truncateUsername(
                        auraUser.username,
                        TOP_AURA_USERNAME_MAX_LENGTH
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Flame
                        className={cn(
                          "h-3 w-3",
                          getAuraFlameClass(auraUser.aura)
                        )}
                      />
                      {formatNumber(auraUser.aura)} aura
                    </span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};

export { TrendingTopicsSkeleton };
export default TrendingTopics;
