"use client";

import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { ChevronRight, Clapperboard, Eye, Flame, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useRef, useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface ExploreGustsRailProps {
  gusts: PostData[];
  onViewAll?: () => void;
}

const VIDEO_HOVER_DELAY = 150;

const GustRailCard = ({ gust }: { gust: PostData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = gust.attachments.find((m) => m.type === "VIDEO");

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video) {
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
  }, []);

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
    }
  }, []);

  if (!videoMedia) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);
  const videoUrl = `/api/media/${videoMedia.id}`;

  return (
    <Link
      className="group relative aspect-[9/16] w-36 shrink-0 overflow-hidden rounded-2xl bg-neutral-900 shadow-sm transition-all duration-300 hover:scale-[1.03] hover:shadow-xl sm:w-44"
      href={`/gusts?id=${gust.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Poster Thumbnail */}
      <Image
        alt={gust.content || "Gust video"}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          isPlaying && hasStartedPlaying ? "opacity-0" : "opacity-100"
        )}
        fill
        sizes="(max-width: 640px) 144px, 176px"
        src={thumbUrl}
        unoptimized
      />

      {/* Video stream for hover preview */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- short-form user clips don't carry captions yet */}
      <video
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
          isPlaying && hasStartedPlaying ? "opacity-100" : "opacity-0"
        )}
        loop
        muted
        playsInline
        preload="metadata"
        ref={videoRef}
        src={videoUrl}
      />

      {/* Top Clapperboard Badge */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-white backdrop-blur-md">
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
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md">
          <Play className="ml-0.5 size-5 fill-white text-white" />
        </div>
      </div>

      {/* Bottom gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/40 to-transparent p-2.5 pt-6 text-white">
        <div className="flex items-center gap-1.5">
          <UserAvatar
            avatarUrl={gust.user.avatarUrl}
            className="size-5 border border-white/40"
          />
          <span className="truncate text-xs font-semibold text-white/95">
            @{gust.user.username}
          </span>
        </div>

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
            <Flame
              className={cn(
                "size-3",
                gust.aura > 0 && "fill-primary text-primary",
                gust.aura < 0 && "text-muted-foreground",
                gust.aura === 0 && "text-white/60"
              )}
            />
            {formatNumber(gust.aura)}
          </span>
        </div>
      </div>
    </Link>
  );
};

export const ExploreGustsRail: React.FC<ExploreGustsRailProps> = ({
  gusts,
  onViewAll,
}) => {
  if (!gusts.length) {
    return null;
  }

  return (
    <section className="sidebar-subcard mb-6 overflow-hidden rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Clapperboard className="text-primary size-4.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-foreground truncate text-sm font-bold">
              Trending Gusts
            </h3>
            <p className="text-muted-foreground truncate text-[11px]">
              Short-form clips taking off right now
            </p>
          </div>
        </div>

        {onViewAll ? (
          <Button
            className="text-primary hover:text-primary h-8 shrink-0 gap-1 px-2 text-xs font-semibold"
            onClick={onViewAll}
            type="button"
            variant="ghost"
          >
            See all
            <ChevronRight className="size-3.5" />
          </Button>
        ) : (
          <Button
            asChild
            className="text-primary hover:text-primary h-8 shrink-0 gap-1 px-2 text-xs font-semibold"
            variant="ghost"
          >
            <Link href="/gusts">
              Watch feed
              <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        )}
      </div>

      {/* Horizontal scrollable rail with a right-edge fade hint */}
      <div className="hide-native-scrollbar flex gap-3 overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] px-4 pt-0.5 pb-4">
        {gusts.map((gust) => (
          <GustRailCard gust={gust} key={gust.id} />
        ))}
      </div>
    </section>
  );
};
