"use client";

import { Button } from "@asm/ui/shadui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Hash, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import { cn, formatNumber } from "@/lib/utils";

import { APPLE_CARD_CLASS, ROW_HOVER_CLASS } from "./sidebar-styles";
import { getTrendingFeed } from "./trending-actions";
import type { TrendingFeed, TrendingItem } from "./trending-actions";

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
  const isLoggedIn = Boolean(user);
  const { data, isError, isFetching, isLoading } = useQuery<TrendingFeed>({
    queryFn: () => getTrendingFeed(false),
    // Key bumped when the payload gained the topAura section so cached data
    // with the old shape (a plain array) is discarded and refetched.
    queryKey: ["trending-feed", "v2"],
    staleTime: 5 * 60 * 1000,
  });

  const items = data?.items ?? [];
  const topAura = data?.topAura ?? [];

  const handleRefresh = useCallback(async () => {
    try {
      const fresh = await getTrendingFeed(true);
      queryClient.setQueryData(["trending-feed", "v2"], fresh);
    } catch {
      // Leave the existing error/empty state intact if the refresh fails
    }
  }, [queryClient]);

  if (isLoading) {
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
            disabled={isFetching}
            onClick={handleRefresh}
            size="icon"
            variant="ghost"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
          </Button>
        ) : null}
      </div>
      {isError ? (
        <div className="px-2.5 py-2">
          <p className="text-muted-foreground text-sm">
            Couldn&apos;t load trending topics right now.
          </p>
          <Button
            className="pill-3d-hover text-muted-foreground mt-2 h-7 rounded-full px-3 text-xs"
            disabled={isFetching}
            onClick={handleRefresh}
            variant="ghost"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
            Retry
          </Button>
        </div>
      ) : null}
      {!isError && items.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {items.slice(0, 6).map((item) => (
            <TrendingRow
              item={item}
              key={item.type === "hashtag" ? item.hashtag : item.userId}
            />
          ))}
        </div>
      ) : null}
      {!isError && items.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm">
          Nothing trending right now.
        </p>
      ) : null}
      {!isError && topAura.length > 0 ? (
        <>
          <div className="border-border/60 mt-2 flex items-center gap-2 border-t px-2 pt-2 pb-1">
            <Flame className="h-4 w-4 shrink-0 text-orange-500" />
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
                      {auraUser.displayName || `@${auraUser.username}`}
                    </span>
                    <UserBadge
                      badge={auraUser.badge}
                      badges={auraUser.badges}
                      className="shrink-0"
                    />
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1 truncate text-xs transition-colors group-hover:text-inherit">
                    @{auraUser.username}
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Flame
                        className={cn(
                          "h-3 w-3",
                          auraUser.aura < 0
                            ? "text-[#7c5cff]"
                            : "text-orange-500"
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
