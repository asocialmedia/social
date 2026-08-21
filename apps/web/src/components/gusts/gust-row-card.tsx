"use client";

import type { PostsPage } from "@asm/db";
import { Clapperboard, Eye, Flame, MessageSquare, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useRef, useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import ExplicitContentGate from "@/components/posts/explicit-content-gate";
import ModeratedNotice from "@/components/posts/moderated-notice";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

// Compact gust card used in feeds that mix gusts and regular posts (profile
// amplified, bookmarks): a 9:16 preview that plays on hover, with the author,
// content, and metrics alongside. Links to the reels player.
const GustRowCard: React.FC<{
  post: PostsPage["posts"][number];
}> = ({ post }) => {
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
        // Ignore seek errors
      }
    }
  }, []);

  if (!videoMedia) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);
  const videoUrl = `/api/media/${videoMedia.id}`;

  // A moderated gust shows the notice instead of the clip.
  if (post.moderated) {
    return (
      <div className="flex items-stretch gap-3 rounded-2xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--background-alt))] p-2.5">
        <ModeratedNotice className="w-full" kind="gust" />
      </div>
    );
  }

  return (
    <Link
      className="group flex items-stretch gap-3 rounded-2xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--background-alt))] p-2.5 transition-colors duration-150 hover:bg-[hsl(var(--muted))]"
      href={`/gusts?id=${post.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 9:16 thumbnail with hover preview */}
      <div className="relative aspect-[9/16] h-40 shrink-0 overflow-hidden rounded-xl bg-black">
        {post.explicitContent ? (
          <ExplicitContentGate
            className="h-full w-full"
            compact
            label="Explicit"
          >
            <Image
              alt={post.content || "Gust video"}
              className="h-full w-full object-cover"
              fill
              sizes="96px"
              src={thumbUrl}
              unoptimized
            />
          </ExplicitContentGate>
        ) : (
          <Image
            alt={post.content || "Gust video"}
            className={cn(
              "h-full w-full object-cover transition-opacity duration-300",
              isHovered ? "opacity-0" : "opacity-100"
            )}
            fill
            sizes="96px"
            src={thumbUrl}
            unoptimized
          />
        )}
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
            src={videoUrl}
          />
        )}
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-white backdrop-blur-md">
          <Clapperboard className="text-primary size-3" />
          <span className="text-[10px] font-bold">Gust</span>
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 text-white backdrop-blur-md">
            <Play className="ml-0.5 size-4 fill-white text-white" />
          </div>
        </div>
      </div>

      {/* Author, content, and metrics */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <UserAvatar avatarUrl={post.user.avatarUrl} className="h-7 w-7" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="text-foreground block truncate text-sm font-semibold">
                {post.user.displayName || post.user.username}
              </span>
              <UserBadge badge={post.user.badge} badges={post.user.badges} />
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              @{post.user.username}
            </span>
          </span>
        </div>

        {post.content ? (
          <p className="text-foreground line-clamp-3 text-sm leading-snug">
            {post.content}
          </p>
        ) : null}

        <div className="text-muted-foreground mt-auto flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <Eye className="size-3.5" />
            {formatNumber(post.viewCount)}
          </span>
          <span className="flex items-center gap-1">
            <Flame
              className={cn(
                "size-3.5",
                post.aura < 0 ? "text-[#7c5cff]" : "text-orange-500"
              )}
            />
            {formatNumber(post.aura)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            {formatNumber(post._count.comments)}
          </span>
        </div>
      </div>
    </Link>
  );
};

export default GustRowCard;
