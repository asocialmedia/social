"use client";

import type { PostData } from "@asm/db";
import {
  Clapperboard,
  Eye,
  Flame,
  MessageSquare,
  Music2,
  Pause,
  Play,
  Plus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import ShareButton from "@/components/home/feedview/share-button";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import UserTooltip from "@/components/layouts/user-tooltip";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import Linkify from "@/helpers/global/linkify";
import { formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface GustCardProps {
  isActive: boolean;
  isMuted: boolean;
  onOpenComments: () => void;
  onOpenUpload: () => void;
  onToggleMute: () => void;
  post: PostData;
}

export const GustCard: React.FC<GustCardProps> = ({
  post,
  isActive,
  isMuted,
  onToggleMute,
  onOpenComments,
  onOpenUpload,
}) => {
  const { user } = useSession();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [showPlayPauseIcon, setShowPlayPauseIcon] = useState<
    "play" | "pause" | null
  >(null);
  const [showHeartAnim, setShowHeartAnim] = useState(false);
  const lastTapRef = useRef<number>(0);
  const iconTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = post.attachments.find((m) => m.type === "VIDEO");

  // Sync active state to play/pause video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (isActive) {
      void (async () => {
        try {
          await video.play();
        } catch {
          // Play request might be interrupted
        }
      })();
    } else {
      video.pause();
    }
  }, [isActive]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      setProgress((video.currentTime / video.duration) * 100);
    }
  }, []);

  const triggerPlayPauseIcon = useCallback((type: "play" | "pause") => {
    setShowPlayPauseIcon(type);
    if (iconTimerRef.current) {
      clearTimeout(iconTimerRef.current);
    }
    iconTimerRef.current = setTimeout(() => {
      setShowPlayPauseIcon(null);
    }, 600);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      void (async () => {
        try {
          await video.play();
          triggerPlayPauseIcon("play");
        } catch {
          // Play interrupted
        }
      })();
    } else {
      video.pause();
      triggerPlayPauseIcon("pause");
    }
  }, [triggerPlayPauseIcon]);

  const handleCardClick = useCallback(() => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap -> trigger flame animation
      setShowHeartAnim(true);
      setTimeout(() => setShowHeartAnim(false), 900);
    } else {
      togglePlay();
    }
    lastTapRef.current = now;
  }, [togglePlay]);

  const handleProgressBarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const video = videoRef.current;
      if (!video || !video.duration) {
        return;
      }
      const val = Number(e.target.value);
      video.currentTime = (val / 100) * video.duration;
      setProgress(val);
    },
    []
  );

  if (!videoMedia) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);
  const videoUrl = `/api/media/${videoMedia.id}`;

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* Video Container (9:16 aspect ratio or responsive full height) */}
      <div className="group relative flex aspect-[9/16] h-full max-h-[calc(100dvh-5rem)] w-auto max-w-full items-center justify-center overflow-hidden rounded-none bg-black shadow-2xl select-none md:rounded-3xl">
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- short-form user clips don't carry captions yet */}
        <video
          className="h-full w-full object-cover"
          loop
          muted={isMuted}
          onTimeUpdate={handleTimeUpdate}
          playsInline
          poster={thumbUrl}
          preload={isActive ? "auto" : "metadata"}
          ref={videoRef}
          src={videoUrl}
        />

        {/* Clickable transparent backdrop for play/pause & double tap */}
        <button
          aria-label="Toggle play or pause"
          className="absolute inset-0 z-0 h-full w-full cursor-pointer border-0 bg-transparent"
          onClick={handleCardClick}
          type="button"
        />

        {/* Play/Pause Pulse Overlay */}
        <AnimatePresence>
          {showPlayPauseIcon ? (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              className="pointer-events-none absolute z-10 flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md"
              exit={{ opacity: 0, scale: 0.8 }}
              initial={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              {showPlayPauseIcon === "play" ? (
                <Play className="ml-1 size-8 fill-white text-white" />
              ) : (
                <Pause className="size-8 fill-white text-white" />
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Double-tap Amplify Burst Animation */}
        <AnimatePresence>
          {showHeartAnim ? (
            <motion.div
              animate={{
                opacity: [0, 1, 1, 0],
                scale: [0.5, 1.2, 1, 1.4],
                y: [0, -30],
              }}
              className="text-primary pointer-events-none absolute z-10 flex flex-col items-center justify-center drop-shadow-[0_0_25px_rgba(255,149,0,0.8)]"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <Flame className="fill-primary size-24" />
              <span className="mt-1 text-xl font-black text-white drop-shadow-md">
                +AURA
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Top Header Overlay */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-linear-to-b from-black/70 via-black/20 to-transparent p-4 text-white">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] shadow-xs">
              <Clapperboard className="size-3.5" />
            </div>
            <span className="text-sm font-bold text-white drop-shadow-sm">
              Gusts
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              aria-label={isMuted ? "Unmute video" : "Mute video"}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-transform hover:scale-110 active:scale-95"
              onClick={onToggleMute}
              type="button"
            >
              {isMuted ? (
                <VolumeX className="size-4.5" />
              ) : (
                <Volume2 className="size-4.5" />
              )}
            </button>
          </div>
        </div>

        {/* Right Floating Action Bar */}
        <div className="absolute right-3 bottom-14 z-20 flex flex-col items-center gap-4">
          {/* Author Avatar with Link / Quick Follow */}
          <div className="relative mb-1">
            <UserTooltip user={post.user}>
              <Link href={`/users/${post.user.username}`}>
                <UserAvatar
                  avatarUrl={post.user.avatarUrl}
                  className="size-11 border-2 border-white shadow-md transition-transform hover:scale-105"
                />
              </Link>
            </UserTooltip>
            {user &&
            user.id !== post.user.id &&
            !post.user.followers?.some((f) => f.followerId === user.id) ? (
              <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2">
                <FollowButton
                  className="h-5 w-5 rounded-full p-0 shadow-md"
                  initialState={{
                    followers: post.user._count?.followers ?? 0,
                    isFollowedByUser: false,
                  }}
                  userId={post.user.id}
                />
              </div>
            ) : null}
          </div>

          {/* Aura Amplify Button */}
          <div className="flex flex-col items-center gap-1">
            <AuraVoteButton
              authorName={post.user.displayName || post.user.username}
              expandable={false}
              initialState={{
                aura: post.aura,
                userVote: post.vote?.[0]?.value ?? 0,
              }}
              postId={post.id}
            />
          </div>

          {/* Comments Button */}
          <div className="flex flex-col items-center gap-1">
            <button
              aria-label="View comments"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-transform hover:scale-110 active:scale-90"
              onClick={onOpenComments}
              type="button"
            >
              <MessageSquare className="size-5" />
            </button>
            <span className="text-[11px] font-semibold text-white drop-shadow-sm">
              {formatNumber(post._count.comments)}
            </span>
          </div>

          {/* Bookmark Button */}
          <div className="flex flex-col items-center gap-1">
            <BookmarkButton
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-transform hover:scale-110 active:scale-90"
              initialState={{
                isBookmarkedByUser: Boolean(post.bookmarks?.length),
              }}
              postId={post.id}
            />
          </div>

          {/* Share Button */}
          <div className="flex flex-col items-center gap-1">
            <ShareButton
              description={post.content}
              postId={post.id}
              thumbnail={thumbUrl}
              title={post.user.displayName || post.user.username}
            />
          </div>

          {/* Create Gust Upload Button */}
          <div className="mt-1 flex flex-col items-center gap-1">
            <button
              aria-label="Upload Gust"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-lg transition-transform hover:scale-110 active:scale-90"
              onClick={onOpenUpload}
              type="button"
            >
              <Plus className="size-6 font-bold" />
            </button>
          </div>
        </div>

        {/* Bottom Metadata Overlay */}
        <div className="absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-black/90 via-black/40 to-transparent p-4 pb-4 text-white">
          {/* Author Name */}
          <div className="flex items-center gap-2">
            <Link
              className="text-sm font-bold text-white hover:underline"
              href={`/users/${post.user.username}`}
            >
              @{post.user.username}
            </Link>
            <span className="text-xs text-white/60">•</span>
            <span className="flex items-center gap-1 text-xs text-white/80">
              <Eye className="size-3" />
              {formatNumber(post.viewCount)} views
            </span>
          </div>

          {/* Caption */}
          {post.content ? (
            <div className="mt-1.5 line-clamp-3 pr-12 text-xs leading-relaxed text-white/95 drop-shadow-xs">
              <Linkify>{post.content}</Linkify>
            </div>
          ) : null}

          {/* Sound Track */}
          <div className="mt-2.5 flex items-center gap-2 text-xs text-white/70">
            <Music2 className="text-primary size-3.5 shrink-0 animate-pulse" />
            <span className="truncate">
              Original audio — @{post.user.username}
            </span>
          </div>
        </div>

        {/* Interactive Progress Slider */}
        <input
          aria-label="Seek video progress"
          className="accent-primary absolute inset-x-0 bottom-0 z-20 h-1.5 w-full cursor-pointer opacity-70 transition-opacity hover:opacity-100"
          max="100"
          min="0"
          onChange={handleProgressBarChange}
          type="range"
          value={progress}
        />
      </div>
    </div>
  );
};
