"use client";

import { Button } from "@asm/ui/shadui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback } from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn, formatNumber } from "@/lib/utils";
import { getTrendingFeed, type TrendingItem } from "./trending-actions";

const APPLE_CARD_CLASS = "sidebar-subcard rounded-2xl p-2";

const ROW_HOVER_CLASS = "sidebar-row-hover";

const TrendingTopicsSkeleton = () => (
  <div className={APPLE_CARD_CLASS}>
    <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
      <div className="h-4 w-4 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-28 animate-pulse rounded-md bg-muted" />
    </div>
    <div className="flex flex-col gap-0.5">
      {[1, 2, 3, 4, 5].map((index) => (
        <div
          className="flex animate-pulse items-center gap-2.5 rounded-lg px-2.5 py-2"
          key={`trending-skeleton-${index}`}
        >
          <div className="h-8 w-8 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 rounded-md bg-muted" />
            <div className="h-3 w-1/3 rounded-md bg-muted" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

interface TrendingRowProps {
  index: number;
  item: TrendingItem;
}

const TrendingRow: React.FC<TrendingRowProps> = ({ index, item }) => {
  if (item.type === "hashtag") {
    return (
      <Link
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
          ROW_HOVER_CLASS
        )}
        href={`/hashtag/${item.hashtag.slice(1)}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#ff9500] to-[#e65500] font-semibold text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">
            {item.hashtag}
          </span>
          <span className="block text-muted-foreground text-xs transition-colors group-hover:text-inherit">
            {formatNumber(item.count)} {item.count === 1 ? "post" : "posts"}
          </span>
        </span>
        <Hash className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-inherit" />
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
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#7c5cff] to-[#5a3ae0] font-semibold text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">
          @{item.username}
        </span>
        <span className="block text-muted-foreground text-xs transition-colors group-hover:text-inherit">
          {formatNumber(item.count)} {item.count === 1 ? "mention" : "mentions"}
        </span>
      </span>
      <UserAvatar avatarUrl={item.avatarUrl} className="h-6 w-6 shrink-0" />
    </Link>
  );
};

const TrendingTopics: React.FC = () => {
  const queryClient = useQueryClient();
  const { data, isFetching, isLoading } = useQuery<TrendingItem[]>({
    queryKey: ["trending-feed"],
    queryFn: () => getTrendingFeed(false),
    staleTime: 5 * 60 * 1000,
  });

  const items = data ?? [];

  const handleRefresh = useCallback(() => {
    getTrendingFeed(true).then((fresh) => {
      queryClient.setQueryData(["trending-feed"], fresh);
    });
  }, [queryClient]);

  if (isLoading) {
    return <TrendingTopicsSkeleton />;
  }

  return (
    <div className={APPLE_CARD_CLASS}>
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
        <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Trending</h2>
        <Button
          aria-label="Refresh trending"
          className="pill-3d-hover ml-auto h-6 w-6 rounded-full text-muted-foreground"
          disabled={isFetching}
          onClick={handleRefresh}
          size="icon"
          variant="ghost"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
          />
        </Button>
      </div>
      {items.length ? (
        <div className="flex flex-col gap-0.5">
          {items.slice(0, 6).map((item, index) => (
            <TrendingRow
              index={index}
              item={item}
              key={item.type === "hashtag" ? item.hashtag : item.userId}
            />
          ))}
        </div>
      ) : (
        <p className="px-2.5 py-2 text-muted-foreground text-sm">
          Nothing trending right now.
        </p>
      )}
    </div>
  );
};

export { TrendingTopicsSkeleton };
export default TrendingTopics;
