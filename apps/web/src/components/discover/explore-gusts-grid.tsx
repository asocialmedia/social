"use client";

import type { PostData, PostsPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Clapperboard,
  Eye,
  Flame,
  Loader2,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { getAuraFlameClass } from "@/lib/aura";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

const VIDEO_HOVER_DELAY = 150;

const ExploreGustTile = ({ post }: { post: PostData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = post.attachments.find((m) => m.type === "VIDEO");
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
      <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-white backdrop-blur-md">
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
            avatarUrl={post.user.avatarUrl}
            className="size-7 rounded-lg border border-white/40"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="truncate text-xs font-semibold text-white/95">
                {post.user.displayName || post.user.username}
              </p>
              <UserBadge badge={post.user.badge} badges={post.user.badges} />
            </div>
            <p className="truncate text-[11px] text-white/70">
              @{post.user.username}
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
  const feedRootRef = useRef<HTMLDivElement>(null);
  const newestIdRef = useRef<string | null>(null);
  const [newGustsCount, setNewGustsCount] = useState(0);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage: PostsPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          "/api/gusts",
          pageParam
            ? {
                searchParams: {
                  cursor: pageParam,
                  excludeModerated: "1",
                  take: "12",
                },
              }
            : { searchParams: { excludeModerated: "1", take: "12" } }
        )
        .json<PostsPage>(),
    queryKey: ["explore-gusts-grid"],
    staleTime: 30 * 1000,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  useEffect(() => {
    if (posts.length > 0 && !newestIdRef.current) {
      newestIdRef.current = posts[0].id;
    }
  }, [posts]);

  // Poll quietly for the newest gust id. When a brand-new one appears, show a
  // pill; the grid and the user's scroll position stay untouched until tapped.
  // If the grid is currently empty, refetch right away so new Gusts actually
  // become visible instead of waiting for a manual refresh.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const fresh = await kyInstance
            .get("/api/gusts", {
              searchParams: { excludeModerated: "1", take: "12" },
            })
            .json<PostsPage>();
          const newest = fresh.posts[0]?.id;
          if (!newest || newest === newestIdRef.current) {
            return;
          }
          newestIdRef.current = newest;
          const knownIds = new Set(posts.map((p) => p.id));
          let count = 0;
          for (const post of fresh.posts) {
            if (knownIds.has(post.id)) {
              break;
            }
            count += 1;
          }
          if (count === 0) {
            return;
          }
          if (posts.length === 0) {
            await refetch();
            setNewGustsCount(0);
            return;
          }
          setNewGustsCount(count);
        } catch {
          // Best-effort polling; ignore transient failures
        }
      })();
    }, 45 * 1000);
    return () => window.clearInterval(interval);
  }, [posts, refetch]);

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const showNewGusts = useCallback(async () => {
    setNewGustsCount(0);
    await refetch();
    let node: HTMLElement | null = feedRootRef.current;
    while (node) {
      if (node.scrollHeight > node.clientHeight) {
        node.scrollTo({ behavior: "smooth", top: 0 });
        break;
      }
      node = node.parentElement;
    }
  }, [refetch]);

  const handleCreateGust = useCallback(() => {
    if (!user) {
      goToLogin();
      return;
    }
    window.location.href = "/gusts?create=true";
  }, [goToLogin, user]);

  if (status === "pending") {
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

  if (status === "error") {
    return (
      <p className="text-destructive px-4 py-12 text-center text-sm">
        Couldn't load Gusts right now. Please try again.
      </p>
    );
  }

  if (posts.length === 0) {
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
        <Button className="mt-2" onClick={handleCreateGust} variant="premium">
          <Plus className="mr-1.5 size-4" />
          Create the First Gust
        </Button>
      </div>
    );
  }

  return (
    <div className="relative" ref={feedRootRef}>
      {newGustsCount > 0 ? (
        <div className="pointer-events-none sticky top-3 z-20 flex justify-center">
          <button
            className="rail-3d-btn pointer-events-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium"
            onClick={showNewGusts}
            type="button"
          >
            <RefreshCw className="size-4" />
            {newGustsCount} new gust{newGustsCount === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
          {posts.map((post) => (
            <ExploreGustTile key={post.id} post={post} />
          ))}
        </div>
        {isFetchingNextPage ? (
          <div className="flex justify-center py-6">
            <Loader2 className="text-primary animate-spin" />
          </div>
        ) : null}
      </InfiniteScrollContainer>
    </div>
  );
};
