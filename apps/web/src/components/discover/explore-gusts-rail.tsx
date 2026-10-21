"use client";

import type { PostData } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Eye,
  Flame,
  Heart,
  Play,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { blueskyMediaIsExplicit } from "@/lib/protocols/content-labels";
import { mixExplorePosts } from "@/lib/recommendations/mix-explore";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface ExploreGustsRailProps {
  gusts: PostData[];
  external?: ExternalPost[];
  onViewAll?: () => void;
}

const VIDEO_HOVER_DELAY = 150;
const EMPTY_EXTERNAL: ExternalPost[] = [];

const GustRailCard = ({
  gust,
  priority,
}: {
  gust: PostData;
  priority?: boolean;
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = gust.attachments?.find((m) => m.type === "VIDEO");
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

  const thumbUrl = getMediaProxyUrl(videoMedia);

  // Poster thumbnail (explicit gusts stay blurred in explore, no gate popup).
  // Top clapperboard badge and bottom gradient overlay frame the clip.
  return (
    <Link
      className="group relative block aspect-[9/16] w-full overflow-hidden rounded-2xl bg-neutral-900 shadow-sm sm:w-44"
      href={`/gusts?id=${gust.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Image
        alt={gust.content || "Gust video"}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          isPlaying && hasStartedPlaying ? "opacity-0" : "opacity-100",
          gust.explicitContent && "opacity-60 blur-lg saturate-50"
        )}
        fill
        // Only the first card in the rail: it is the one on screen at paint
        // time, and on a quiet explore page it becomes the LCP. The rest of the
        // rail stays lazy so it does not compete with the feed for bandwidth.
        loading={priority ? "eager" : "lazy"}
        sizes="(max-width: 640px) 144px, 176px"
        src={thumbUrl}
        unoptimized
      />
      {gust.explicitContent ? null : (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- short-form user clips don't carry captions yet
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

      <div className="chip-3d explore-gust-chip absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 text-white">
        <Clapperboard className="text-primary size-3" />
        <span className="text-[10px] font-bold">Gust</span>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/40 to-transparent p-2.5 pt-6 text-white">
        <div className="flex items-center gap-1.5">
          <UserAvatar
            avatarUrl={gust.user?.avatarUrl}
            className="size-6 rounded-lg border border-white/40"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-semibold text-white/95">
              {gust.user?.displayName || gust.user?.username || "Anonymous"}
            </p>
            <p className="truncate text-[10px] text-white/70">
              @{gust.user?.username || "unknown"}
            </p>
          </div>
          <UserBadge
            badge={gust.user?.badge}
            badges={gust.user?.badges}
            className="hidden shrink-0 sm:inline-flex"
            communityRoles={gust.user?.communityMemberships}
          />
        </div>
        <UserBadge
          badge={gust.user?.badge}
          badges={gust.user?.badges}
          className="mt-1 shrink-0 sm:hidden"
          communityRoles={gust.user?.communityMemberships}
        />
        {gust.content ? (
          <p className="mt-1 line-clamp-1 text-[11px] text-white/80">
            {gust.content}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/70">
          <span className="flex items-center gap-1">
            <Eye className="size-3" />
            {formatNumber(gust.viewCount)}
          </span>
          <span className="flex items-center gap-0.5">
            <Flame className={cn("size-3", getAuraFlameClass(gust.aura))} />
            {formatNumber(gust.aura)}
          </span>
        </div>
      </div>
    </Link>
  );
};

function ExternalGustRailCard({ post }: { post: ExternalPost }) {
  const media = post.media.find((item) => item.type === "video");
  return (
    <Link
      className="group relative block aspect-9/16 w-full overflow-hidden rounded-2xl bg-neutral-900"
      href={`/gusts?id=${encodeURIComponent(post.id)}`}
    >
      <Image
        alt={media?.alt || post.text || "Bluesky Gust"}
        src={media?.thumbnailUrl ?? noMediaImage}
        fill
        className={cn(
          "object-cover",
          blueskyMediaIsExplicit(post) && "blur-lg saturate-50"
        )}
        sizes="(max-width: 640px) 144px, 176px"
        unoptimized
      />
      <span className="chip-3d absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
        <BlueskyIcon className="size-3" /> Gust
      </span>
      <Play
        aria-hidden
        className="absolute top-1/2 left-1/2 size-8 -translate-1/2 fill-white text-white drop-shadow"
      />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/50 to-transparent p-2.5 pt-8 text-white">
        <div className="flex min-w-0 items-center gap-1.5">
          <UserAvatar
            avatarUrl={post.author.avatarUrl}
            seed={post.author.id}
            className="size-6 rounded-lg"
          />
          <span className="min-w-0 truncate text-xs font-semibold">
            {post.author.displayName || post.author.handle}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-white/70">
          @{post.author.handle}
        </p>
        <p className="mt-1 line-clamp-1 text-[11px] text-white/80">
          {post.text}
        </p>
        <span className="mt-1.5 flex items-center gap-1 text-[10px] text-white/70">
          <Heart className="size-3" />
          {formatNumber(post.upstreamCounts.likes ?? 0)}
        </span>
      </div>
    </Link>
  );
}

export const ExploreGustsRail: React.FC<ExploreGustsRailProps> = ({
  gusts,
  external = EMPTY_EXTERNAL,
  onViewAll,
}) => {
  const reducedMotion = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const entries = mixExplorePosts(
    gusts.filter(
      (post) =>
        !post.moderated &&
        post.attachments.some((media) => media.type === "VIDEO")
    ),
    external.filter((post) =>
      post.media.some((media) => media.type === "video")
    )
  ).slice(0, 32);
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    const left = element.scrollLeft > 2;
    const right =
      element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
    setEdges((current) =>
      current.left === left && current.right === right
        ? current
        : { left, right }
    );
  }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !entries.length) {
      return;
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, entries.length]);
  const slide = (direction: number) =>
    scroller.current?.scrollBy({
      behavior: reducedMotion ? "auto" : "smooth",
      left: direction * scroller.current.clientWidth * 0.8,
    });
  if (!entries.length) {
    return null;
  }
  return (
    <section aria-label="Trending Gusts" className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="icon-btn-3d flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Clapperboard className="text-primary size-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-sm font-semibold">
              Trending Gusts
            </h2>
            <p className="text-muted-foreground truncate text-[11px]">
              Taking off across your networks
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {edges.left ? (
            <Button
              aria-label="Previous trending Gusts"
              className="icon-btn-3d size-8 rounded-full"
              size="icon"
              variant="ghost"
              onClick={() => slide(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          ) : null}
          {edges.right ? (
            <Button
              aria-label="Next trending Gusts"
              className="icon-btn-3d size-8 rounded-full"
              size="icon"
              variant="ghost"
              onClick={() => slide(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          ) : null}
          {onViewAll ? (
            <Button
              className="text-primary h-8 gap-1 px-2 text-xs font-semibold"
              onClick={onViewAll}
              variant="ghost"
            >
              See all
              <ChevronRight className="size-3.5" />
            </Button>
          ) : (
            <Button
              asChild
              className="text-primary h-8 gap-1 px-2 text-xs"
              variant="ghost"
            >
              <Link href="/gusts">
                Watch feed
                <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div
        className="hide-native-scrollbar flex gap-3 overflow-x-auto overscroll-x-contain pt-0.5 pb-1"
        onScroll={measure}
        ref={scroller}
      >
        {entries.map((entry, index) => (
          <RecommendationTracker
            className="w-36 shrink-0 sm:w-44"
            exposureFeed="trending"
            key={`${entry.source}:${entry.post.id}`}
            networkSource={entry.source}
            networkToken={entry.post.networkRecommendationToken}
            postId={entry.post.id}
          >
            {entry.source === "asm" ? (
              <GustRailCard gust={entry.post} priority={index === 0} />
            ) : (
              <ExternalGustRailCard post={entry.post} />
            )}
          </RecommendationTracker>
        ))}
      </div>
    </section>
  );
};
