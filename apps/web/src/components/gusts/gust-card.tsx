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
import UserBadge from "@/components/layouts/user-badge";
import UserTooltip from "@/components/layouts/user-tooltip";
import BookmarkButton from "@/components/posts/bookmark-button";
import PostMoreButton from "@/components/posts/post-more-button";
import ViewTracker from "@/components/posts/view-counter";
import Linkify from "@/helpers/global/linkify";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

import GustVoteButton from "./gust-vote-button";
import { useGustVote } from "./use-gust-vote";

interface GustCardProps {
  interactive?: boolean;
  isActive: boolean;
  isMuted: boolean;
  onOpenComments: () => void;
  onToggleMute: () => void;
  post: PostData;
  shouldMountVideo?: boolean;
}

export const GustCard: React.FC<GustCardProps> = ({
  post,
  isActive,
  isMuted,
  onToggleMute,
  onOpenComments,
  interactive = true,
  shouldMountVideo = true,
}) => {
  const { user } = useSession();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [showPlayPauseIcon, setShowPlayPauseIcon] = useState<
    "play" | "pause" | null
  >(null);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const lastTapRef = useRef<number>(0);
  const iconTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Floating aura bursts from repeated taps (TikTok-style). Each tap spawns a
  // flame that drifts up and fades; ids keep them unique so many can be on
  // screen at once.
  const [auraBursts, setAuraBursts] = useState<
    { id: number; x: number; y: number }[]
  >([]);
  const burstIdRef = useRef(0);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoMedia = post.attachments.find((m) => m.type === "VIDEO");
  const authorName = post.user.displayName || post.user.username;

  // Shared vote state so the rail button and the double-tap gesture stay in
  // sync (same ["vote-info", postId] cache entry).
  const { amplify } = useGustVote({
    authorName,
    initialState: {
      aura: post.aura,
      userVote: post.vote?.[0]?.value ?? 0,
    },
    postId: post.id,
  });

  // Ensure DOM video.muted matches React state across browsers
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

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
      // eslint-disable-next-line react-compiler -- reset progress bar when video is inactive
      setProgress(0);
    }

    return () => {
      try {
        video.pause();
      } catch {
        // Ignore aborts
      }
    };
  }, [isActive]);

  const wasPlayingBeforeHideRef = useRef(false);

  // Pause video if user switches tabs or browser is backgrounded,
  // restoring playback on return only if the clip was playing when hidden.
  useEffect(() => {
    const handleVisibilityChange = () => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      if (document.hidden) {
        wasPlayingBeforeHideRef.current = !video.paused;
        video.pause();
      } else if (isActive && wasPlayingBeforeHideRef.current) {
        void (async () => {
          try {
            await video.play();
          } catch {
            // Play request might be interrupted
          }
        })();
        wasPlayingBeforeHideRef.current = false;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isActive]);

  useEffect(
    () => () => {
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.src = "";
          video.load();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
      }
      if (iconTimerRef.current) {
        clearTimeout(iconTimerRef.current);
      }
    },
    []
  );

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

  const spawnAuraBurst = useCallback((clientX: number, clientY: number) => {
    const id = (burstIdRef.current += 1);
    setAuraBursts((prev) => [
      ...prev.slice(-6),
      { id, x: clientX, y: clientY },
    ]);
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
    }
    burstTimerRef.current = setTimeout(() => {
      setAuraBursts([]);
    }, 900);
  }, []);

  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      // The duplicate feed copy is a pixel mirror for the infinite wrap; it
      // must not fire mutations that fight the first copy's vote cache.
      if (!interactive) {
        return;
      }
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 280;

      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        // Double tap -> cancel pending single tap togglePlay and amplify
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        amplify();
        const rect = e.currentTarget.getBoundingClientRect();
        spawnAuraBurst(e.clientX - rect.left, e.clientY - rect.top);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
        }
        singleTapTimerRef.current = setTimeout(() => {
          togglePlay();
          singleTapTimerRef.current = null;
        }, DOUBLE_TAP_DELAY);
      }
    },
    [amplify, interactive, spawnAuraBurst, togglePlay]
  );

  if (!videoMedia) {
    return null;
  }

  const thumbUrl = getMediaProxyUrl(videoMedia);
  const videoUrl = `/api/media/${videoMedia.id}`;
  const canFollow =
    user &&
    user.id !== post.user.id &&
    !post.user.followers?.some((f) => f.followerId === user.id);
  const isOwner = user?.id === post.user.id;
  const isFollowedByUser = Boolean(
    post.user.followers?.some((f) => f.followerId === user?.id)
  );
  const isBookmarked = Boolean(post.bookmarks?.length);

  let preloadMode: "auto" | "metadata" | "none" = "none";
  if (isActive) {
    preloadMode = "auto";
  } else if (shouldMountVideo) {
    preloadMode = "metadata";
  }

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
          preload={preloadMode}
          ref={videoRef}
          src={shouldMountVideo ? videoUrl : undefined}
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

        {/* Repeated-tap Aura Bursts: TikTok-style floating flames that tilt by sequence id */}
        <AnimatePresence>
          {auraBursts.map((burst) => {
            // Each burst tilts slightly based on its sequence id so repeated
            // taps feel connected rather than identical stamps.
            const rotation = ((burst.id % 5) - 2) * 8;
            return (
              <motion.div
                animate={{
                  opacity: [0, 1, 1, 0],
                  rotate: rotation,
                  scale: [0.4, 1.1, 0.9],
                  y: [0, -90],
                }}
                className="pointer-events-none absolute z-10 flex flex-col items-center"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0, rotate: rotation - 4, scale: 0.4 }}
                key={burst.id}
                style={{ left: burst.x, top: burst.y }}
                transition={{ duration: 0.85, ease: "easeOut" }}
              >
                <Flame
                  className="text-primary fill-primary drop-shadow-[0_0_18px_rgba(255,149,0,0.9)]"
                  size={44}
                />
                <span className="text-sm font-black text-white drop-shadow-md">
                  +1
                </span>
              </motion.div>
            );
          })}
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
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  className="truncate text-sm font-bold text-white drop-shadow-md hover:underline"
                  href={`/users/${post.user.username}`}
                >
                  {authorName}
                </Link>
                <UserBadge badge={post.user.badge} />
                {canFollow ? (
                  <FollowButton
                    className="h-7 shrink-0 rounded-full px-3 text-xs"
                    initialState={{
                      followers: post.user._count?.followers ?? 0,
                      isFollowedByUser,
                    }}
                    userId={post.user.id}
                  />
                ) : null}
              </div>
              <Link
                className="block truncate text-xs text-white/80 drop-shadow-md hover:underline"
                href={`/users/${post.user.username}`}
              >
                @{post.user.username}
              </Link>
            </div>
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
            interactive={interactive}
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
            interactive={interactive}
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
            description={
              post.content || `Watch ${authorName}'s gust on asocialmedia`
            }
            dialogDescription="Share this gust with your network"
            dialogTitle="Share Gust"
            postId={post.id}
            shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/gusts?id=${post.id}`}
            thumbnail={thumbUrl}
            title={`${authorName} (@${post.user.username})'s Gust on asocialmedia`}
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
            kind="gust"
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
