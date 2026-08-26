"use client";

import { clientLog } from "@asm/config/debug";
import type { Media, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Dialog, DialogContent, DialogTitle } from "@asm/ui/shadui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { formatDate } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileIcon,
  RotateCcw,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import Comments from "@/components/comments/comments";
import FollowButton from "@/components/layouts/follow-button";
import Spinner3D from "@/components/layouts/spinner-3d";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import { AiGeneratedBadge } from "@/components/media/ai-generated-badge";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import ExplicitContentGate from "@/components/posts/explicit-content-gate";
import ModeratedNotice from "@/components/posts/moderated-notice";
import PostMoreButton from "@/components/posts/post-more-button";
import { PostMeta } from "@/components/tags/post-meta";
import Linkify from "@/helpers/global/linkify";
import { useExplicitRevealed } from "@/lib/explicit-reveal-store";
import { formatFileName } from "@/lib/format-file-name";
import { useToast } from "@/lib/gooey-toast";
import { canModeratePost } from "@/lib/moderation";
import { cn, formatNumber } from "@/lib/utils";
import {
  getMediaImageUrl,
  getMediaProxyUrl,
  getMediaVariantUrl,
  getMediaVideoUrl,
} from "@/lib/utils/image-url";

import { CustomVideoPlayer } from "./custom-video-player";
// eslint-disable-next-line import/no-cycle -- related posts reuse post-card which renders media-previews, which opens this viewer
import RelatedPosts from "./related-posts";
import ShareButton from "./share-button";
import { SVGViewer } from "./svg-viewer";

const getMediaUrl = (mediaId: string, download = false) =>
  `/api/media/${mediaId}${download ? "?download=true" : ""}`;

// Fullscreen display URL for an image: prefers orig-img, the pipeline's
// source-resolution WebP re-encode (generated for non-animated sources up to
// 1600px), so fullscreen never shows a downscaled ladder rung. Larger
// sources fall through to the 1200px rung, then to the published original;
// every hop is handled server-side by the variant route.
function getViewerImageUrl(media: Media): string {
  return getMediaImageUrl(media, "orig-img-webp.webp");
}

// If async media (image/video/svg) hasn't fired its load event within this
// window, the viewer gives up waiting and shows the retry state instead of
// spinning forever.
const MEDIA_LOAD_TIMEOUT_MS = 12_000;

// Only IMAGE / SVG / VIDEO gate rendering on an async onLoad/onLoadedData event.
// AUDIO renders immediately with no load callback, so it must never be left
// in a loading state or the skeleton would stay forever.
function hasAsyncLoad(media: Media | undefined): boolean {
  return (
    !!media &&
    (media.type === "IMAGE" ||
      media.type === "VIDEO" ||
      media.mimeType === "image/svg+xml")
  );
}

interface MediaViewerProps {
  initialIndex?: number;
  isOpen: boolean;
  media: Media[];
  onClose: () => void;
  onNavigate?: (index: number) => void;
  post?: PostData;
  // When true, render the media screen as a standalone page (full-viewport, no
  // Radix dialog/overlay/portal). Used by the /posts/[id]/media/... route so the
  // viewer reads as its own page instead of an overlay on the post page.
  standalone?: boolean;
}

function getShareThumbnail(
  post: PostData | null | undefined,
  currentMedia: Media | undefined
): string | undefined {
  if (currentMedia) {
    if (currentMedia.mimeType === "image/gif") {
      return getMediaProxyUrl(currentMedia);
    }
    return getMediaVariantUrl(currentMedia.id, "lg-webp.webp");
  }
  if (post?.attachments[0]) {
    return getMediaProxyUrl(post.attachments[0]);
  }
  if (post) {
    return `/posts/${post.id}/opengraph-image`;
  }
  return undefined;
}

// React Compiler cannot lower `throw` statements inside component try blocks,
// so response status checks live in this module-scoped helper.
function ensureResponseOk(response: Response, message: string): void {
  if (!response.ok) {
    throw new Error(message);
  }
}

const MediaViewer = ({
  media,
  initialIndex = 0,
  isOpen,
  onClose,
  onNavigate,
  post,
  standalone = false,
}: MediaViewerProps) => {
  const { toast } = useToast();
  const { user: sessionUser } = useSession();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const currentMedia = media[currentIndex];

  // Describes everything the loading flags derive from. Computed BEFORE the
  // states it seeds so they can initialize from the first value: this makes
  // the mount render (including SSR) correct with zero sync passes, which the
  // previous null-initialized adjust-during-render block could not do - on the
  // server setState is a no-op, its null guard never converged, and every
  // server render pass re-fired the sync forever (the "too many re-renders"
  // crash on /posts/[id]/media/[index]).
  const loadSyncInput = useMemo(
    () => ({
      currentIndex,
      isOpen,
      loadAttempt,
      media,
      moderated: Boolean(post?.moderated),
    }),
    [currentIndex, isOpen, loadAttempt, media, post?.moderated]
  );

  // Sync isLoading with the current item. Async media (image/video/svg) flip it
  // off via their onLoad/onLoadedData; everything else has no such event, so
  // clear it immediately to avoid an infinite skeleton. Error state resets per
  // item too. Moderated posts show the notice instead of media, so skip the
  // whole loading lifecycle.
  // Initialized from the first loadSyncInput; the adjust-during-render block
  // below then only runs when the input genuinely changes (client-side item
  // navigation), never on mount or during SSR.
  const [isLoading, setIsLoading] = useState(
    () =>
      loadSyncInput.isOpen &&
      !loadSyncInput.moderated &&
      hasAsyncLoad(loadSyncInput.media[loadSyncInput.currentIndex])
  );
  // Set when the media element errors or the load times out, so the content
  // area shows a retry button instead of an endless skeleton. `loadAttempt`
  // remounts the media element on retry.
  const [mediaError, setMediaError] = useState(false);
  // Whether the explicit-content gate has been dismissed for this post.
  // Shared across surfaces (feed card, post page, media page) via the reveal
  // store, so Continue is confirmed once per session, not once per mount.
  const explicitRevealed = useExplicitRevealed(post?.id);
  const [prevLoadSyncInput, setPrevLoadSyncInput] = useState(loadSyncInput);
  if (prevLoadSyncInput !== loadSyncInput) {
    setPrevLoadSyncInput(loadSyncInput);
    if (loadSyncInput.isOpen) {
      if (loadSyncInput.moderated) {
        // Force the load state off for moderated posts so the notice shows,
        // never a stale spinner.
        setIsLoading(false);
      } else {
        setIsLoading(
          hasAsyncLoad(loadSyncInput.media[loadSyncInput.currentIndex])
        );
      }
      setMediaError(false);
    }
  }

  // Bumped on every video timeupdate so the load deadline below resets while
  // bytes keep flowing; a stalled clip stops bumping it and times out. Updates
  // are ignored once loading has finished so the timeout effect is not
  // needlessly recreated for the lifetime of the clip.
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);
  const [mediaProgressTick, setMediaProgressTick] = useState(0);
  const handleMediaProgress = useCallback(() => {
    if (!isLoadingRef.current) {
      return;
    }
    setMediaProgressTick((tick) => tick + 1);
  }, []);

  // Fail-safe: if an async media item never fires its load event (e.g. the
  // storage range request stalls), surface the error state instead of leaving
  // the viewer stuck on a spinner forever. The timer resets on each progress
  // tick so a slow-but-active download is not treated as a failure.
  useEffect(() => {
    if (!isOpen || !isLoading || post?.moderated) {
      return;
    }
    const timeout = setTimeout(() => {
      setIsLoading(false);
      setMediaError(true);
    }, MEDIA_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    isOpen,
    isLoading,
    // oxlint-disable react/exhaustive-effect-dependencies -- these inputs
    // intentionally restart the load deadline; they are timer-reset triggers,
    // not values read inside the effect body.
    currentIndex,
    loadAttempt,
    mediaProgressTick,
    // oxlint-enable react/exhaustive-effect-dependencies
    post?.moderated,
  ]);

  const handlePrevious = useCallback(() => {
    const next = currentIndex > 0 ? currentIndex - 1 : media.length - 1;
    onNavigate?.(next);
    setCurrentIndex(next);
    setIsLoading(hasAsyncLoad(media[next]));
  }, [currentIndex, media, onNavigate]);

  const handleNext = useCallback(() => {
    const next = currentIndex < media.length - 1 ? currentIndex + 1 : 0;
    onNavigate?.(next);
    setCurrentIndex(next);
    setIsLoading(hasAsyncLoad(media[next]));
  }, [currentIndex, media, onNavigate]);

  const handleSelectThumb = useCallback(
    (index: number) => {
      if (index === currentIndex) {
        return;
      }
      onNavigate?.(index);
      setCurrentIndex(index);
      setIsLoading(hasAsyncLoad(media[index]));
    },
    [currentIndex, media, onNavigate]
  );

  const handleMediaLoaded = useCallback(() => {
    setIsLoading(false);
    setMediaError(false);
  }, []);

  const handleMediaError = useCallback(() => {
    setIsLoading(false);
    setMediaError(true);
  }, []);

  // Videos frequently fire a transient `error` (e.g. a range request hiccup)
  // and then recover and play. Immediately showing the fatal retry overlay
  // over a playing video is worse than waiting, so for video an `error` is
  // deliberately ignored here: if the clip genuinely never loads, the
  // load-timeout flips to the retry state; if it recovers, onLoadedData or
  // onPlaying clears the loading state instead.
  // (Intentionally empty.)
  const handleVideoError = useCallback(() => {
    /* empty */
  }, []);

  const handleRetry = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
    setMediaError(false);
    setIsLoading(hasAsyncLoad(currentMedia));
  }, [currentMedia]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      if (currentMedia) {
        const response = await fetch(`/api/media/download/${currentMedia.id}`);

        if (response.status === 429) {
          toast({
            description: "Slow down a bit, then try again",
            title: "Too Many Downloads",
            variant: "destructive",
          });
        } else {
          ensureResponseOk(response, "Failed to download file");

          const blob = await response.blob();
          const downloadUrl = window.URL.createObjectURL(blob);

          const a = document.createElement("a");
          a.href = downloadUrl;
          a.download = formatFileName(currentMedia.key);
          document.body.append(a);
          a.click();

          window.URL.revokeObjectURL(downloadUrl);
          a.remove();
        }
      } else {
        toast({
          description: "No file to download yet",
          title: "Download Failed",
          variant: "destructive",
        });
      }
    } catch (error) {
      clientLog.error("Download failed:", error);
      toast({
        description: "Couldn't download that file, try again?",
        title: "Download Failed",
        variant: "destructive",
      });
    }
    // The catch above never rethrows and the try body has no early returns,
    // so resetting here matches the previous `finally` semantics.
    setIsDownloading(false);
  };

  // eslint-disable-next-line react/no-unstable-nested-components -- DownloadButton uses parent component state and functions, making it reasonable to keep nested
  const DownloadButton = () => (
    <Button
      className="flex items-center gap-2"
      disabled={isDownloading}
      onClick={handleDownload}
      variant="secondary"
    >
      {isDownloading ? (
        <>
          <span className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
          Fetching file...
        </>
      ) : (
        <>
          <Download className="h-4 w-4" />
          Download {currentMedia ? formatFileName(currentMedia.key) : ""}
        </>
      )}
    </Button>
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevious();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      }
      // In dialog mode Escape is handled by Radix Dialog (onOpenChange -> onClose),
      // so we only handle it ourselves in standalone (page) mode.
      if (standalone && e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handlePrevious, handleNext, standalone, onClose]);

  const renderImageMedia = (item: Media) => {
    if (item.mimeType === "image/svg+xml") {
      return (
        <div className="relative flex h-full w-full items-center justify-center">
          <SVGViewer
            key={`${item.id}-${loadAttempt}`}
            className={cn(
              "flex h-full w-full items-center justify-center",
              isLoading && "opacity-0"
            )}
            onDownload={handleDownload}
            onLoad={handleMediaLoaded}
            url={getMediaUrl(item.id)}
          />
        </div>
      );
    }

    return (
      <div className="relative flex h-full max-h-full w-full items-center justify-center">
        {/* key remounts the image per media item + retry so the load state
            resets cleanly instead of reusing one <img> whose src keeps
            swapping */}
        <Image
          key={`${item.id}-${loadAttempt}`}
          alt={item.altText || `Media item ${currentIndex + 1}`}
          className={cn(
            "object-contain transition-opacity duration-200",
            isLoading ? "opacity-0" : "opacity-100"
          )}
          fill
          onError={handleMediaError}
          onLoad={handleMediaLoaded}
          priority
          quality={100}
          sizes="95vw"
          src={getViewerImageUrl(item)}
          unoptimized
        />
      </div>
    );
  };

  const renderVideoMedia = (item: Media) => (
    <div className="relative flex h-full max-h-full w-full items-center justify-center focus-within:outline-none">
      <CustomVideoPlayer
        autoPlay
        className={cn(
          "h-full max-h-full w-auto outline-hidden focus:outline-hidden focus-visible:outline-none",
          "shadow-lg",
          // Fade in on load via opacity instead of display:none: a display:none
          // <video> with preload=metadata may never fire onLoadedData, which
          // would leave the media viewer stuck on its skeleton forever.
          isLoading && "opacity-0"
        )}
        hlsSrc={
          item.hasHls
            ? getMediaVariantUrl(item.id, "hls/master.m3u8")
            : undefined
        }
        key={`${item.id}-${loadAttempt}`}
        onError={handleVideoError}
        onLoadedData={handleMediaLoaded}
        onPlaying={handleMediaLoaded}
        onProgress={handleMediaProgress}
        poster={getMediaProxyUrl(item)}
        src={getMediaVideoUrl(item.id)}
      />
    </div>
  );

  const renderAudioMedia = (item: Media) => (
    <div className="bg-background/50 flex flex-col items-center gap-4 rounded-lg p-8">
      <div className="bg-primary/10 flex h-40 w-40 items-center justify-center rounded-full">
        <FileIcon className="text-primary h-20 w-20" />
      </div>
      <p className="text-lg font-medium">{formatFileName(item.key)}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- audio content may not have captions available */}
      <audio
        aria-label={`Audio ${currentIndex + 1} of ${media.length}`}
        autoPlay
        className="w-full max-w-md"
        controls
        src={getMediaUrl(item.id)}
      />
      <DownloadButton />
    </div>
  );

  const renderMedia = () => {
    if (!currentMedia) {
      return <p className="text-destructive">No media available</p>;
    }

    switch (currentMedia.type) {
      case "IMAGE": {
        return renderImageMedia(currentMedia);
      }
      case "VIDEO": {
        return renderVideoMedia(currentMedia);
      }
      case "AUDIO": {
        return renderAudioMedia(currentMedia);
      }
      default: {
        return <p className="text-destructive">Unsupported media type</p>;
      }
    }
  };

  const renderActionBar = () => {
    if (!post) {
      return null;
    }
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <AuraVoteButton
            authorName={post.user.displayName}
            initialState={{
              aura: post.aura,
              userVote: post.vote[0]?.value || 0,
            }}
            postId={post.id}
          />
          <BookmarkButton
            className="h-9 w-9"
            initialState={{
              isBookmarkedByUser: post.bookmarks.some(
                (bookmark) => bookmark.userId === sessionUser?.id
              ),
            }}
            postId={post.id}
          />
          <ShareButton
            description={post.content}
            dialogDescription="Share this media with your network"
            dialogTitle="Share Media"
            postId={post.id}
            shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/posts/${post.id}/media/${currentIndex}`}
            thumbnail={getShareThumbnail(post, currentMedia)}
            title={`${post.user.displayName || post.user.username} (@${post.user.username}) on asocialmedia`}
          />
        </div>
        <span className="text-muted-foreground pr-2 text-sm lg:hidden">
          {formatNumber(post.viewCount)} views
        </span>
      </div>
    );
  };

  const isSelf = post ? sessionUser?.id === post.user.id : false;
  // The more-button is shown to the author and to admins so moderation is
  // reachable from the full-screen viewer too.
  const canModerate = post ? canModeratePost(sessionUser, post) : false;

  const renderMobileHeader = () => {
    if (!post) {
      return null;
    }
    return (
      <div className="flex shrink-0 flex-col bg-linear-to-b from-black/80 to-transparent px-3 pt-3 pb-5 lg:hidden">
        <div className="flex items-center justify-between">
          <button
            aria-label="Close viewer"
            className="rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110"
            onClick={onClose}
            type="button"
          >
            <X className="h-6 w-6" />
          </button>
          {canModerate ? (
            <PostMoreButton className="shrink-0" post={post} />
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Link
            aria-label="View profile"
            className="shrink-0 rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            href={`/users/${post.user.username}`}
          >
            <UserAvatar avatarUrl={post.user.avatarUrl} className="h-10 w-10" />
          </Link>
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <Link
                className="block truncate font-semibold text-white hover:underline"
                href={`/users/${post.user.username}`}
              >
                {post.user.displayName}
              </Link>
              <UserBadge badge={post.user.badge} badges={post.user.badges} />
            </span>
            <Link
              className="block truncate text-white/70 hover:underline"
              href={`/users/${post.user.username}`}
            >
              @{post.user.username}
            </Link>
          </div>
          {isSelf ? null : (
            <FollowButton
              initialState={{
                followers: post.user._count?.followers ?? 0,
                isFollowedByUser: post.user.followers.length > 0,
              }}
              userId={post.user.id}
            />
          )}
        </div>
      </div>
    );
  };

  const body = (
    <div className="flex h-full w-full overflow-hidden">
      <div className="relative flex h-full min-w-0 flex-1 flex-col bg-black">
        {renderMobileHeader()}

        <div className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden">
          {currentMedia ? (
            <AiGeneratedBadge
              className="absolute bottom-4 left-4 z-50"
              media={currentMedia}
            />
          ) : null}
          {(() => {
            if (post?.moderated) {
              return (
                <div className="flex h-full w-full items-center justify-center bg-black/60">
                  <ModeratedNotice className="mx-4 max-w-sm" kind="post" />
                </div>
              );
            }
            if (post?.explicitContent) {
              return (
                <ExplicitContentGate
                  className="h-full w-full"
                  revealKey={post?.id}
                >
                  {renderMedia()}
                </ExplicitContentGate>
              );
            }
            return renderMedia();
          })()}

          {/* Loading spinner over the content area. The media element stays
              mounted (hidden behind this) so its load event can still fire.
              Not shown for moderated posts (the notice is the content) or
              while the explicit-content gate is unrevealed (the Continue
              prompt is the content). pointer-events-none so it can never
              intercept the gate's Continue button. */}
          {isLoading &&
          !post?.moderated &&
          !(post?.explicitContent && !explicitRevealed) ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <Spinner3D />
            </div>
          ) : null}

          {/* Fail-safe: the media errored or timed out, so offer a retry
              instead of leaving the user staring at a spinner. */}
          {mediaError &&
          !post?.moderated &&
          !(post?.explicitContent && !explicitRevealed) ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/60 px-6 text-center">
              <p className="text-sm font-medium text-white/90">
                Couldn&apos;t load this media.
              </p>
              <Button
                className="gap-2 rounded-full px-6"
                onClick={handleRetry}
                type="button"
                variant="premium"
              >
                <RotateCcw className="size-4" />
                Retry
              </Button>
            </div>
          ) : null}

          <button
            aria-label="Close viewer"
            className="absolute top-4 left-3 z-50 hidden rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110 lg:flex"
            onClick={onClose}
            type="button"
          >
            <X className="h-6 w-6" />
          </button>

          {media.length > 1 && (
            <>
              <button
                aria-label="Previous media"
                className="absolute top-1/2 left-3 z-50 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110"
                onClick={handlePrevious}
                type="button"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                aria-label="Next media"
                className="absolute top-1/2 right-3 z-50 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110"
                onClick={handleNext}
                type="button"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              <div className="absolute top-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 backdrop-blur-md">
                <span className="text-sm text-white">
                  {currentIndex + 1} / {media.length}
                </span>
              </div>
            </>
          )}
        </div>

        {media.length > 1 &&
        !post?.moderated &&
        !(post?.explicitContent && !explicitRevealed) ? (
          <div className="flex justify-center border-t border-white/5 bg-black px-3 py-2.5">
            <div
              className="flex max-w-full [scrollbar-width:none] items-center gap-1 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
              role="tablist"
              aria-label="Media thumbnails"
            >
              {media.map((item, index) => {
                const isActive = index === currentIndex;
                const isVideo = item.type === "VIDEO";
                return (
                  <button
                    key={item.id}
                    aria-current={isActive}
                    aria-label={`Go to media ${index + 1} of ${media.length}`}
                    className={cn(
                      "relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-900 p-0.5 transition-all sm:h-14 sm:w-14",
                      isActive
                        ? "border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.9)]"
                        : "opacity-60 hover:border hover:border-white/30 hover:opacity-100"
                    )}
                    onClick={() => handleSelectThumb(index)}
                    role="tab"
                    type="button"
                  >
                    <span className="flex h-full w-full overflow-hidden rounded-[4px]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- tiny 320px thumb-webp, no optimization needed */}
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        loading="lazy"
                        sizes="56px"
                        src={
                          isVideo
                            ? getMediaProxyUrl(item)
                            : getMediaImageUrl(item, "thumb-webp.webp")
                        }
                      />
                    </span>
                    {isVideo ? (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/90 pl-px">
                          <span className="block h-0 w-0 border-y-[2.5px] border-l-[4px] border-y-transparent border-l-zinc-900" />
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Uploader-authored alt text, displayed only on this standalone
            page - never on feed cards or dialog-mode galleries. */}
        {standalone && currentMedia?.altText ? (
          <div className="border-t border-white/5 bg-black px-3 py-2.5">
            <p className="mx-auto max-w-xl text-center text-xs leading-relaxed text-white/70 sm:text-sm">
              {currentMedia.altText}
            </p>
          </div>
        ) : null}

        {post ? renderActionBar() : null}
      </div>

      {post ? (
        <aside className="hidden h-full w-[420px] flex-col border-l border-white/10 bg-[hsl(var(--background))] lg:flex">
          <div className="flex items-center gap-3 px-4 py-3">
            <Link
              aria-label="View profile"
              className="focus-visible:ring-ring shrink-0 rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2"
              href={`/users/${post.user.username}`}
            >
              <UserAvatar
                avatarUrl={post.user.avatarUrl}
                className="h-10 w-10"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <Link
                  className="text-foreground block truncate font-semibold hover:underline"
                  href={`/users/${post.user.username}`}
                >
                  {post.user.displayName}
                </Link>
                <UserBadge badge={post.user.badge} badges={post.user.badges} />
              </span>
              <Link
                className="text-muted-foreground block truncate hover:underline"
                href={`/users/${post.user.username}`}
              >
                @{post.user.username}
              </Link>
            </div>
            {canModerate ? (
              <PostMoreButton className="shrink-0" post={post} />
            ) : null}
          </div>

          <div className="px-4 pt-1 pb-2">
            <Linkify>
              <p className="text-foreground text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap">
                {post.content}
              </p>
            </Linkify>
            {post.tags?.length || post.mentions?.length ? (
              <div className="mt-3">
                <PostMeta
                  mentions={post.mentions.map((m) => m.user)}
                  tags={post.tags}
                />
              </div>
            ) : null}
          </div>

          <div className="text-muted-foreground flex items-center gap-2 px-4 pb-2 text-sm">
            {/* The timestamp is rendered in the viewer's local timezone, which
                can differ between server and client, so hydration is suppressed
                to avoid a mismatch on refresh. formatDate keeps the shape
                deterministic across locales. */}
            <span suppressHydrationWarning>
              {formatDate(new Date(post.createdAt), "d MMM yyyy")}
            </span>
            <span aria-hidden>·</span>
            <span suppressHydrationWarning>
              {formatDate(new Date(post.createdAt), "h:mm a")}
            </span>
            <div className="flex-1" />
            <span>{formatNumber(post.viewCount)} views</span>
          </div>

          <div className="border-border/60 flex items-center gap-1 border-y px-4 py-2">
            <AuraVoteButton
              authorName={post.user.displayName}
              initialState={{
                aura: post.aura,
                userVote: post.vote[0]?.value || 0,
              }}
              postId={post.id}
            />
            <div className="flex-1" />
            <BookmarkButton
              className="h-9 w-9"
              initialState={{
                isBookmarkedByUser: post.bookmarks.some(
                  (bookmark) => bookmark.userId === sessionUser?.id
                ),
              }}
              postId={post.id}
            />
            <ShareButton
              description={post.content}
              dialogDescription="Share this media with your network"
              dialogTitle="Share Media"
              postId={post.id}
              shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/posts/${post.id}/media/${currentIndex}`}
              thumbnail={getShareThumbnail(post, currentMedia)}
              title={`${post.user.displayName || post.user.username} (@${post.user.username}) on asocialmedia`}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3">
              <Comments post={post} />
            </div>
            <div>
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-sm font-semibold">View more content</span>
                <Link
                  aria-label="View all posts on the global feed"
                  className="text-primary shrink-0 text-sm font-medium hover:underline"
                  href="/"
                >
                  View all posts
                </Link>
              </div>
              <RelatedPosts excludePostId={post.id} />
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );

  return standalone ? (
    <div
      className="flex h-dvh w-full overflow-hidden bg-black"
      style={{ viewTransitionName: "media-viewer" }}
    >
      {body}
    </div>
  ) : (
    <Dialog onOpenChange={onClose} open={isOpen}>
      {/* The named view transition makes the post <-> media route swap a smooth
          crossfade into/out of the fullscreen viewer instead of an instant pop. */}
      <DialogContent
        className="h-dvh max-h-dvh max-w-none border-none bg-black p-0 [&>button:last-child]:hidden"
        style={{ viewTransitionName: "media-viewer" }}
      >
        <DialogTitle asChild>
          <VisuallyHidden>
            Media Viewer - {currentIndex + 1} of {media.length}
          </VisuallyHidden>
        </DialogTitle>

        {body}
      </DialogContent>
    </Dialog>
  );
};

export default MediaViewer;
