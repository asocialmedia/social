"use client";

import type { PostData, PostsPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Clapperboard, Eye, Flame, Play, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { useBlueskyFeed } from "@/components/protocols/use-bluesky-feed";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { getAuraFlameClass } from "@/lib/aura/aura";
import kyInstance from "@/lib/ky";
import { mixExplorePosts } from "@/lib/recommendations/mix-explore";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

import { ExploreNetworkPost } from "./explore-network-cards";

const VIDEO_HOVER_DELAY = 150;

const ExploreGustTile = ({ post }: { post: PostData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = post.attachments?.find((m) => m.type === "VIDEO");
  const videoUrl = videoMedia ? `/api/media/${videoMedia.id}` : "";

  const handleMouseEnter = useCallback(() => {
    if (!videoUrl) {
      return;
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video) {
        if (!video.src) {
          video.src = videoUrl;
        }
        void (async () => {
          try {
            await video.play();
            setIsPlaying(true);
            setHasStartedPlaying(true);
          } catch {
            setIsPlaying(false);
          }
        })();
      }
    }, VIDEO_HOVER_DELAY);
  }, [videoUrl]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        if (video.readyState >= 1 && video.duration > 2) {
          video.currentTime = 2;
        }
      } catch {
        // Ignore seek aborts
      }
      setIsPlaying(false);
      setHasStartedPlaying(false);
    }
  }, []);

  if (!videoMedia) {
    return null;
  }

  // Moderated gusts stay out of the explore grid entirely: the route already
  // excludes them (excludeModerated=1), but a stale payload from a race is
  // skipped rather than rendered as a moderation tile.
  if (post.moderated) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);

  return (
    <Link
      className="group relative aspect-9/16 w-full overflow-hidden rounded-2xl bg-neutral-900 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
      href={`/gusts?id=${post.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Poster Thumbnail */}
      <Image
        alt={post.content || "Gust video"}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          isPlaying && hasStartedPlaying ? "opacity-0" : "opacity-100",
          // Explicit gusts are shown blurred in explore - no gate popup, the
          // clip stays hidden until opened.
          post.explicitContent && "opacity-60 blur-lg saturate-50"
        )}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        src={thumbUrl}
        unoptimized
      />

      {/* Hover Stream Preview (not for explicit gusts - the clip stays hidden) */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- short-form user clips don't carry captions yet */}
      {post.explicitContent ? null : (
        <video
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            isPlaying && hasStartedPlaying ? "opacity-100" : "opacity-0"
          )}
          loop
          muted
          playsInline
          preload="none"
          ref={videoRef}
        />
      )}

      {/* Top Clapperboard Badge */}
      <div className="chip-3d explore-gust-chip absolute top-2.5 left-2.5 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 text-white">
        <Clapperboard className="text-primary size-3" />
        <span className="text-[10px] font-bold">Gust</span>
      </div>

      {/* Center Play indicator on hover */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200",
          isPlaying ? "opacity-0" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md">
          <Play className="ml-0.5 size-6 fill-white text-white" />
        </div>
      </div>

      {/* Bottom gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/40 to-transparent p-3 pt-8 text-white">
        <div className="flex items-center gap-2">
          <UserAvatar
            avatarUrl={post.user?.avatarUrl}
            className="size-7 rounded-lg border border-white/40"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="truncate text-xs font-semibold text-white/95">
                {post.user?.displayName || post.user?.username || "Anonymous"}
              </p>
              <UserBadge
                badge={post.user?.badge}
                badges={post.user?.badges}
                communityRoles={post.user?.communityMemberships}
              />
            </div>
            <p className="truncate text-[11px] text-white/70">
              @{post.user?.username || "unknown"}
            </p>
          </div>
        </div>

        {post.content ? (
          <p className="mt-1.5 line-clamp-2 text-xs text-white/85">
            {post.content}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between text-xs text-white/70">
          <span className="flex items-center gap-1 font-medium">
            <Eye className="size-3.5" />
            {formatNumber(post.viewCount)}
          </span>
          <span className="flex items-center gap-1 font-medium">
            <Flame className={cn("size-3.5", getAuraFlameClass(post.aura))} />
            {formatNumber(post.aura)}
          </span>
        </div>
      </div>
    </Link>
  );
};

export const ExploreGustsGrid: React.FC = () => {
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const network = useNetworkSettings();
  const remote = useBlueskyFeed(
    "personalized",
    true,
    user?.id ?? "guest",
    "video",
    false,
    "explore"
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
    refetch,
  } = useInfiniteQuery({
    enabled: network.ready,
    getNextPageParam: (lastPage: PostsPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      kyInstance
        .get("/api/gusts", {
          searchParams: {
            ...(pageParam ? { cursor: pageParam } : {}),
            excludeModerated: "1",
            mode: "personalized",
            network: "1",
            profile: network.settings.preferences.activeProfileId,
            surface: "explore",
            take: "12",
          },
          signal,
        })
        .json<PostsPage>(),
    queryKey: ["explore-gusts-grid", user?.id ?? "guest", network.scope],
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const externalPosts = useMemo(
    () =>
      remote.data?.pages
        .flatMap((page) => page.items)
        .filter((post) => post.media.some((media) => media.type === "video")) ??
      [],
    [remote.data]
  );
  const mixed = useMemo(
    () => mixExplorePosts(posts, externalPosts),
    [posts, externalPosts]
  );
  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
    if (remote.hasNextPage && !remote.isFetching) {
      void remote.fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching, remote]);

  const handleCreateGust = useCallback(() => {
    if (!user) {
      goToLogin();
      return;
    }
    window.location.href = "/gusts?create=true";
  }, [goToLogin, user]);

  if ((status === "pending" || remote.isPending) && !mixed.length) {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            className="bg-muted/40 aspect-9/16 w-full animate-pulse rounded-2xl"
            // eslint-disable-next-line react/no-array-index-key -- skeleton placeholders
            key={i}
          />
        ))}
      </div>
    );
  }

  if (status === "error" && !mixed.length) {
    return (
      <FeedErrorState
        message="Couldn’t load Gusts right now. Please try again."
        onRetry={() => {
          void refetch();
          void remote.refetch();
        }}
      />
    );
  }

  if (mixed.length === 0 && !remote.isPending) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt="No Gusts"
          className="size-32 rounded-full object-contain opacity-80"
          draggable={false}
          height={128}
          src={noMediaImage}
          width={128}
        />
        <h3 className="text-foreground text-lg font-bold">No Gusts yet</h3>
        <p className="text-muted-foreground max-w-xs text-sm">
          Explore short-form video clips or share your own high-energy video
          with the community!
        </p>
        {remote.isError ? (
          <Button
            variant="premium"
            onClick={() => {
              void remote.refetch();
            }}
          >
            Retry Bluesky videos
          </Button>
        ) : null}
        <Button className="mt-2" onClick={handleCreateGust} variant="premium">
          <Plus className="mr-1.5 size-4" />
          Create the First Gust
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <InfiniteScrollContainer
        onBottomReached={handleBottomReached}
        prefetchDistance={1500}
      >
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
          {mixed.map((entry) =>
            entry.source === "asm" ? (
              <RecommendationTracker
                key={`asm:${entry.post.id}`}
                postId={entry.post.id}
                networkSource="asm"
                networkToken={entry.post.networkRecommendationToken}
              >
                <ExploreGustTile post={entry.post} />
              </RecommendationTracker>
            ) : (
              <ExploreNetworkPost
                key={`bluesky:${entry.post.id}`}
                post={entry.post}
                gust
              />
            )
          )}
        </div>
        {remote.isError ? (
          <div className="flex justify-center p-4">
            <Button
              variant="premium"
              onClick={() => {
                void remote.refetch();
              }}
            >
              Retry Bluesky videos
            </Button>
          </div>
        ) : null}
        {isFetchingNextPage || remote.isFetching ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={`gust-loading-${index}`}
                className="bg-muted/40 aspect-9/16 animate-pulse rounded-2xl"
              />
            ))}
          </div>
        ) : null}
      </InfiniteScrollContainer>
    </div>
  );
};
