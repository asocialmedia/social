"use client";

import type { PostsPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Clapperboard, Eye, Flame, Loader2, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useMemo, useRef, useState } from "react";

import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import ModeratedNotice from "@/components/posts/moderated-notice";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

import EmptyFeedState from "./empty-feed-state";
import FeedCaughtUp from "./feed-caught-up";

interface UserGustsFeedProps {
  isOwnProfile?: boolean;
  userId: string;
}

const GustGridItem = ({ post }: { post: PostsPage["posts"][number] }) => {
  const videoMedia = post.attachments.find((m) => m.type === "VIDEO");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video) {
        void (async () => {
          try {
            await video.play();
          } catch {
            // Video autoplay might be restricted
          }
        })();
      }
    }, 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        if (video.readyState >= 1) {
          video.currentTime = 0;
        }
      } catch {
        // Ignore seek error
      }
    }
  }, []);

  if (!videoMedia) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);
  const videoUrl = `/api/media/${videoMedia.id}`;

  // A moderated gust shows a moderation card (same 9:16 tile shape) instead of
  // the thumbnail; clicking it opens the gust page where the notice lives.
  if (post.moderated) {
    return (
      <Link
        aria-label="Open moderated gust"
        className="group relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-muted/20 shadow-sm transition-transform duration-300 hover:scale-[1.02] hover:shadow-lg"
        href={`/gusts?id=${post.id}`}
      >
        <ModeratedNotice bare className="mx-3" kind="gust" vertical />
      </Link>
    );
  }

  return (
    <Link
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-neutral-900 shadow-sm transition-transform duration-300 hover:scale-[1.02] hover:shadow-lg"
      href={`/gusts?id=${post.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Poster Thumbnail (explicit gusts stay blurred) */}
      <Image
        alt={post.content || "Gust video"}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          isHovered ? "opacity-0" : "opacity-100",
          post.explicitContent && "blur-lg opacity-60 saturate-50"
        )}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
        src={thumbUrl}
        unoptimized
      />

      {/* Video Preview on Hover (not for explicit gusts - clip stays hidden) */}
      {post.explicitContent ? null : (
        <video
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            isHovered ? "opacity-100" : "opacity-0"
          )}
          loop
          muted
          playsInline
          preload="none"
          ref={videoRef}
          src={isHovered ? videoUrl : undefined}
        />
      )}

      {/* Top Overlay Badge */}
      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-xs text-white backdrop-blur-md">
        <Clapperboard className="text-primary size-3" />
        <span className="text-[11px] font-medium">Gust</span>
      </div>

      {/* Bottom Gradient Overlay with Metrics */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-6 text-white">
        {post.content ? (
          <p className="line-clamp-2 text-xs font-medium text-white/90 drop-shadow-xs">
            {post.content}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between text-[11px] text-white/80">
          <div className="flex items-center gap-1">
            <Eye className="size-3.5" />
            <span className="font-semibold">
              {formatNumber(post.viewCount)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Flame
              className={cn(
                "size-3.5",
                post.aura > 0 && "fill-primary text-primary",
                post.aura < 0 && "text-muted-foreground",
                post.aura === 0 && "text-white/60"
              )}
            />
            <span className="font-semibold">{formatNumber(post.aura)}</span>
          </div>
        </div>
      </div>

      {/* Center Play Indicator on Hover */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md">
          <Play className="ml-0.5 size-5 fill-white text-white" />
        </div>
      </div>
    </Link>
  );
};

const UserGustsFeed: React.FC<UserGustsFeedProps> = ({
  userId,
  isOwnProfile = false,
}) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          `/api/users/${userId}/posts`,
          pageParam
            ? { searchParams: { cursor: pageParam, filter: "gusts" } }
            : { searchParams: { filter: "gusts" } }
        )
        .json<PostsPage>(),
    queryKey: ["post-feed", "user-gusts", userId],
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (status === "pending") {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            className="bg-muted/40 aspect-[9/16] w-full animate-pulse rounded-2xl"
            // eslint-disable-next-line react/no-array-index-key -- Skeleton placehold indices
            key={i}
          />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <p className="text-destructive py-8 text-center">
        An error occurred while loading Gusts.
      </p>
    );
  }

  if (status === "success" && !posts.length) {
    return (
      <EmptyFeedState
        action={
          isOwnProfile ? (
            <Button asChild variant="premium">
              <Link href="/gusts?create=true">
                <Clapperboard className="mr-1.5 size-4" />
                Upload a Gust
              </Link>
            </Button>
          ) : undefined
        }
        description="Short-form video content from this profile will appear here."
        image={noMediaImage}
        title="No Gusts yet"
      />
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:gap-4">
        {posts.map((post) => (
          <GustGridItem key={post.id} post={post} />
        ))}
      </div>
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="text-primary animate-spin" />
        </div>
      ) : null}
      {!hasNextPage && posts.length > 0 ? (
        <FeedCaughtUp note="You've seen every Gust from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserGustsFeed);
