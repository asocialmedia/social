"use client";

import type { PostData } from "@asm/db";
import {
  Eye,
  Flame,
  MessageSquare,
  Pause,
  Play,
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
import BookmarkButton from "@/components/posts/bookmark-button";
import PostMoreButton from "@/components/posts/post-more-button";
import ViewTracker from "@/components/posts/view-counter";
import Linkify from "@/helpers/global/linkify";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

import GustVoteButton from "./gust-vote-button";

interface GustCardProps {
  isActive: boolean;
  isMuted: boolean;
  onOpenComments: () => void;
  onToggleMute: () => void;
  post: PostData;
}

export const GustCard: React.FC<GustCardProps> = ({
  post,
  isActive,
  isMuted,
  onToggleMute,
  onOpenComments,
}) => {
  const { user } = useSession();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [showPlayPauseIcon, setShowPlayPauseIcon] = useState<
    "play" | "pause" | null
  >(null);
  const [showHeartAnim, setShowHeartAnim] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const lastTapRef = useRef<number>(0);
  const iconTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = post.attachments.find((m) => m.type === "VIDEO");

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
      // Reset the clip to the start so it never resumes mid-way when it
      // becomes active again.
      video.currentTime = 0;
    }
  }, [isActive]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      setProgress((video.currentTime / video.duration) * 100);
    }
  }, []);

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

  if (!videoMedia) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);
  const videoUrl = `/api/media/${videoMedia.id}`;
  const authorName = post.user.displayName || post.user.username;
  const canFollow =
    user &&
    user.id !== post.user.id &&
    !post.user.followers?.some((f) => f.followerId === user.id);
  const isOwner = user?.id === post.user.id;
  const isFollowedByUser = Boolean(
    post.user.followers?.some((f) => f.followerId === user?.id)
  );
  const isBookmarked = Boolean(post.bookmarks?.length);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="group relative h-full w-full overflow-hidden bg-black select-none sm:aspect-[9/16] sm:h-full sm:max-h-[calc(100dvh-2.5rem)] sm:w-auto sm:max-w-full sm:rounded-2xl sm:shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.12),0_8px_20px_-8px_rgba(0,0,0,0.3)] lg:rounded-3xl">
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- short-form user clips don't carry captions yet */}
        <video
          className="h-full w-full object-contain"
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
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md"
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
            </div>
          ) : null}
        </AnimatePresence>

        {/* Double-tap Amplify Burst Animation */}
        <AnimatePresence>
          {showHeartAnim ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <motion.div
                animate={{
                  opacity: [0, 1, 1, 0],
                  scale: [0.5, 1.2, 1, 1.4],
                  y: [0, -30],
                }}
                className="text-primary flex flex-col items-center justify-center drop-shadow-[0_0_25px_rgba(255,149,0,0.8)]"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <Flame className="fill-primary size-24" />
                <span className="mt-1 text-xl font-black text-white drop-shadow-md">
                  +AURA
                </span>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>

        {/* Bottom scrim so the overlay text stays readable */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-56 bg-linear-to-t from-black/85 via-black/35 to-transparent" />

        {/* Bottom-left: author info + follow (like the post card) + caption */}
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 px-4 pr-24 pb-8">
          <div className="flex items-center gap-3">
            <UserTooltip user={post.user}>
              <Link href={`/users/${post.user.username}`}>
                <UserAvatar
                  avatarUrl={post.user.avatarUrl}
                  className="size-10 shrink-0 rounded-xl ring-2 ring-white/60"
                />
              </Link>
            </UserTooltip>
            <div className="min-w-0 flex-1">
              <Link
                className="block truncate text-sm font-bold text-white drop-shadow-md hover:underline"
                href={`/users/${post.user.username}`}
              >
                {authorName}
              </Link>
              <Link
                className="block truncate text-xs text-white/80 drop-shadow-md hover:underline"
                href={`/users/${post.user.username}`}
              >
                @{post.user.username}
              </Link>
            </div>
            {canFollow ? (
              <FollowButton
                className="h-8 shrink-0 rounded-full px-4 text-xs"
                initialState={{
                  followers: post.user._count?.followers ?? 0,
                  isFollowedByUser,
                }}
                userId={post.user.id}
              />
            ) : null}
          </div>

          {post.content ? (
            <div className="max-w-[78%]">
              <p
                className={cn(
                  "text-xs leading-relaxed text-white/95 drop-shadow-md",
                  !captionExpanded && "line-clamp-3"
                )}
              >
                <Linkify>{post.content}</Linkify>
              </p>
              {post.content.length > 80 ? (
                <button
                  className="mt-0.5 text-xs font-semibold text-white/80 drop-shadow-md hover:text-white"
                  onClick={() => setCaptionExpanded((prev) => !prev)}
                  type="button"
                >
                  {captionExpanded ? "Show less" : "More"}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-1.5 text-xs font-semibold text-white/85 drop-shadow">
            <Eye className="size-4" />
            <span className="tabular-nums">{formatNumber(post.viewCount)}</span>
            <span className="text-white/60">views</span>
          </div>
        </div>

        {/* Right action rail */}
        <div className="absolute right-3 bottom-24 z-20 flex flex-col items-center gap-4">
          {/* Amplify (upvote) */}
          <GustVoteButton
            authorName={authorName}
            direction="up"
            initialState={{
              aura: post.aura,
              userVote: post.vote?.[0]?.value ?? 0,
            }}
            postId={post.id}
          />

          {/* Mute author (downvote) */}
          <GustVoteButton
            authorName={authorName}
            direction="down"
            initialState={{
              aura: post.aura,
              userVote: post.vote?.[0]?.value ?? 0,
            }}
            postId={post.id}
          />

          {/* Eddie (comments) */}
          <div className="flex flex-col items-center gap-1">
            <button
              aria-label="View comments"
              className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
              onClick={onOpenComments}
              type="button"
            >
              <MessageSquare className="size-5" />
            </button>
            <span className="text-[11px] font-semibold text-white/90 tabular-nums drop-shadow">
              {formatNumber(post._count.comments)}
            </span>
          </div>

          {/* Share */}
          <ShareButton
            className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full p-0 transition-transform hover:scale-105 active:scale-95"
            defaultTab="link"
            description={post.content}
            postId={post.id}
            shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/gusts?id=${post.id}`}
            thumbnail={thumbUrl}
            title={authorName}
          />

          {/* Bookmark */}
          <BookmarkButton
            className={cn(
              "rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full p-0 transition-transform hover:scale-105 active:scale-95",
              isBookmarked && "rail-3d-btn-gold"
            )}
            initialState={{
              isBookmarkedByUser: isBookmarked,
            }}
            postId={post.id}
          />

          {/* More (owners only) */}
          {isOwner ? (
            <PostMoreButton
              className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full p-0 transition-transform hover:scale-105 active:scale-95"
              post={post}
            />
          ) : null}

          {/* Mute / unmute (aligned below the More button) */}
          <button
            aria-label={isMuted ? "Unmute video" : "Mute video"}
            className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
            onClick={onToggleMute}
            type="button"
          >
            {isMuted ? (
              <VolumeX className="size-5" />
            ) : (
              <Volume2 className="size-5" />
            )}
          </button>
        </div>

        {/* Seek bar - hidden native thumb, click or drag anywhere to seek */}
        <div className="absolute inset-x-0 bottom-0 z-30 px-1 pb-1">
          <div className="group relative h-1 w-full rounded-full bg-white/20 transition-all group-hover:h-1.5">
            <div
              className="h-full rounded-full bg-linear-to-r from-[#ff9500] to-[#e65500]"
              style={{ width: `${progress}%` }}
            />
            <input
              aria-label="Seek video progress"
              className="seek-slider absolute -top-1.5 right-0 bottom-0 left-0 h-4 w-full cursor-pointer opacity-0"
              max="100"
              min="0"
              onChange={handleProgressBarChange}
              type="range"
              value={progress}
            />
          </div>
        </div>
      </div>

      {isActive ? <ViewTracker postId={post.id} /> : null}
    </div>
  );
};
