"use client";

import { clientLog } from "@asm/config/debug";
import type { Media, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Dialog, DialogContent, DialogTitle } from "@asm/ui/shadui/dialog";
import { Slider } from "@asm/ui/shadui/slider";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { formatDate } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileIcon,
  Maximize,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

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

import {
  CustomVideoPlayer,
  isClickInVideoContent,
} from "./custom-video-player";
import type { VideoPlaybackState } from "./custom-video-player";
// eslint-disable-next-line import/no-cycle -- media-previews renders this viewer's dialog galleries, and the sidebar reuses its video preview; both are used at render time only
import { VideoPreview } from "./media-previews";
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

/** 3D dual-border chip used by the mobile media page's control buttons. */
const MOBILE_CHIP_3D =
  "bg-linear-to-b from-[#3a3f4a] to-[#23262e] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_6px_rgba(0,0,0,0.35)]";

/** m:ss clock for the mobile media page's video controls. */
function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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
  const router = useRouter();
  // defaultValue: false + initializeWithValue: false keep the server render
  // and the first client render identical (the media query is only evaluated
  // after mount), so the hideControls DOM branches never cause a hydration
  // mismatch.
  const isMobileView = useMediaQuery("(max-width: 768px)", {
    defaultValue: false,
    initializeWithValue: false,
  });
  const [uiVisible, setUiVisible] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const currentMedia = media[currentIndex];

  // The bottom panel drives the video directly (the built-in player controls
  // are hidden on every size; the panel's control rows take over on both
  // mobile and desktop): the video element plus a mirror of its state.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoState, setVideoState] = useState<VideoPlaybackState>({
    currentTime: 0,
    duration: 0,
    isMuted: false,
    isPlaying: false,
    playbackRate: 1,
    volume: 1,
  });
  const handleExternalVideoState = useCallback(
    (state: VideoPlaybackState) => setVideoState(state),
    []
  );
  const handleVideoPlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);
  const handleVideoToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = !video.muted;
  }, []);
  // Speed cycles 1x -> 1.25x -> 1.5x -> 2x -> back to 1x.
  const handleVideoCycleSpeed = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const speeds = [1, 1.25, 1.5, 2];
    const nextIndex = (speeds.indexOf(video.playbackRate) + 1) % speeds.length;
    video.playbackRate = speeds[nextIndex] ?? 1;
  }, []);
  // Desktop seek slider: scrub the element directly and mirror the time in
  // state so the slider tracks instantly (timeupdate keeps it in sync anyway).
  const handleVideoSeek = useCallback((value: number[]) => {
    const [newTime] = value;
    if (newTime === undefined) {
      return;
    }
    const video = videoRef.current;
    if (video) {
      video.currentTime = newTime;
    }
    setVideoState((prev) => ({ ...prev, currentTime: newTime }));
  }, []);
  const handleVideoFullscreen = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    // Fullscreening the video element lets the browser rotate the phone to
    // landscape for playback.
    await video.requestFullscreen();
  }, []);

  // Tapping the blank area (letterbox/background) toggles the UI (bottom
  // panel on mobile, bottom chrome on desktop, plus the top bar) instead of
  // pausing the video. Clicks on the visible picture keep their play/pause
  // behavior (the video element's own handler runs first), and buttons always
  // work. The letterbox check is needed because the video element fills the
  // whole media area: its box covers the blank bars too, so only the
  // picture's rect distinguishes "video" from "blank".
  const handleMediaAreaClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }
      const video = videoRef.current;
      if (video && isClickInVideoContent(event.clientX, event.clientY, video)) {
        return;
      }
      setUiVisible((visible) => !visible);
    },
    []
  );

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
          // The box fills the media area; object-contain letterboxes the
          // video inside, centered for any orientation and screen size.
          "h-full max-h-full w-full outline-hidden focus:outline-hidden focus-visible:outline-none",
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
        // The built-in on-video overlay is suppressed on every size; the
        // bottom panel's control rows drive playback instead (on desktop the
        // seek slider + chips live in the bottom chrome). Desktop keeps the
        // keyboard shortcuts and double-click skip zones.
        hideControls
        desktopGestures={!isMobileView}
        key={`${item.id}-${loadAttempt}`}
        onError={handleVideoError}
        onExternalState={handleExternalVideoState}
        onLoadedData={handleMediaLoaded}
        onPlaying={handleMediaLoaded}
        onProgress={handleMediaProgress}
        poster={getMediaProxyUrl(item)}
        src={getMediaVideoUrl(item.id)}
        videoRef={videoRef}
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

  // Grid of ALL the post's media in the sidebar's post section, so a
  // multi-photo post shows every attachment next to the fullscreen view. The
  // item being viewed is ringed; tapping any tile jumps to it. Video tiles
  // reuse the feed's VideoPreview so they keep the feed's 16:9 proportions
  // and hover controls (play/pause + mute).
  const renderSidebarGridTileContent = (item: Media, index: number) => {
    const alt = item.altText || `Media ${index + 1}`;
    if (item.type === "IMAGE") {
      if (item.mimeType === "image/svg+xml") {
        return (
          <object
            aria-label={alt}
            className="h-full w-full"
            data={getMediaUrl(item.id)}
            type="image/svg+xml"
          />
        );
      }
      return (
        // eslint-disable-next-line @next/next/no-img-element -- sidebar grid thumb
        <img
          alt={alt}
          className="h-full w-full object-cover"
          decoding="async"
          loading="lazy"
          src={getMediaImageUrl(item, "md-webp.webp")}
        />
      );
    }
    if (item.type === "VIDEO") {
      return <VideoPreview media={item} />;
    }
    return (
      <div className="flex h-full w-full items-center justify-center">
        <FileIcon className="text-primary h-5 w-5" />
      </div>
    );
  };

  const renderSidebarMediaGrid = () => {
    let cols = "grid-cols-3";
    if (media.length === 1) {
      cols = "grid-cols-1";
    } else if (media.length === 2) {
      cols = "grid-cols-2";
    }
    return (
      <div className={cn("grid gap-1.5", cols)}>
        {media.map((item, index) => {
          const isActive = index === currentIndex;
          // Video tiles size themselves to the feed's 16:9 ratio; the rest
          // stay square so mixed grids keep a tidy row height.
          const isVideo = item.type === "VIDEO";
          return (
            <button
              key={item.id}
              aria-current={isActive}
              aria-label={`Go to media ${index + 1} of ${media.length}`}
              className={cn(
                "relative overflow-hidden rounded-lg bg-zinc-900",
                !isVideo && "aspect-square",
                isActive ? "ring-2 ring-white" : "opacity-70 hover:opacity-100"
              )}
              onClick={() => handleSelectThumb(index)}
              type="button"
            >
              {renderSidebarGridTileContent(item, index)}
            </button>
          );
        })}
      </div>
    );
  };

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
    // Mirrors the mobile panel's actions row: the 3D eddies chip + aura on
    // the left, share + bookmark on the right.
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            aria-label="View eddies"
            className={cn(
              "flex h-11 items-center gap-1.5 rounded-full px-3.5 transition-all duration-200 hover:brightness-110 active:translate-y-px",
              MOBILE_CHIP_3D
            )}
            onClick={() => router.push(`/posts/${post.id}`)}
            type="button"
          >
            <MessageSquare
              className={cn(
                "size-4.5",
                post._count.comments > 0 && "fill-current"
              )}
            />
            <span className="text-sm font-semibold tabular-nums">
              {post._count.comments}
            </span>
          </button>
          <AuraVoteButton
            authorName={post.user.displayName}
            initialState={{
              aura: post.aura,
              userVote: post.vote[0]?.value || 0,
            }}
            postId={post.id}
          />
        </div>
        <div className="flex items-center gap-2">
          <ShareButton
            className="h-9 w-9"
            description={post.content}
            dialogDescription="Share this media with your network"
            dialogTitle="Share Media"
            postId={post.id}
            shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/posts/${post.id}/media/${currentIndex}`}
            thumbnail={getShareThumbnail(post, currentMedia)}
            title={`${post.user.displayName || post.user.username} (@${post.user.username}) on asocialmedia`}
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

  const body = (
    <div className="flex h-full w-full overflow-hidden">
      <div className="relative flex h-full min-w-0 flex-1 flex-col bg-black">
        {/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a blank-area tap toggles the UI; every real control inside is an actual button */}
        <div
          className={cn(
            // Media centers on the full screen; the mobile panel and the
            // desktop chrome float over it with their scrim, exactly like the
            // mobile layout.
            "relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden"
          )}
          onClick={handleMediaAreaClick}
        >
          {/* Dialog galleries keep the overlay badge; the standalone page
              shows it in the attribution row below the media instead. */}
          {!standalone && currentMedia ? (
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
            className={cn(
              "absolute top-3 left-3 z-50 flex h-10 w-10 items-center justify-center rounded-full p-0 text-white transition-[opacity,visibility] duration-300 hover:brightness-110 active:translate-y-px",
              MOBILE_CHIP_3D,
              !uiVisible && "pointer-events-none invisible opacity-0"
            )}
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Compact mobile top bar: close (above) + post options (right). */}
          {canModerate && post ? (
            <div
              className={cn(
                "absolute top-3 right-3 z-50 transition-[opacity,visibility] duration-300 lg:hidden",
                !uiVisible && "pointer-events-none invisible opacity-0"
              )}
            >
              <PostMoreButton
                className="shrink-0"
                post={post}
                variant="media-page"
              />
            </div>
          ) : null}

          {media.length > 1 && (
            <>
              <button
                aria-label="Previous media"
                className={cn(
                  "absolute top-1/2 left-3 z-50 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all duration-300 hover:bg-black/60 hover:brightness-110",
                  !uiVisible && "pointer-events-none invisible opacity-0"
                )}
                onClick={handlePrevious}
                type="button"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                aria-label="Next media"
                className={cn(
                  "absolute top-1/2 right-3 z-50 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all duration-300 hover:bg-black/60 hover:brightness-110",
                  !uiVisible && "pointer-events-none invisible opacity-0"
                )}
                onClick={handleNext}
                type="button"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              <div
                className={cn(
                  "absolute top-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 backdrop-blur-md transition-[opacity,visibility] duration-300",
                  !uiVisible && "invisible opacity-0"
                )}
              >
                <span className="text-sm text-white">
                  {currentIndex + 1} / {media.length}
                </span>
              </div>
            </>
          )}
        </div>
        {/* oxlint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}

        {/* Mobile bottom panel: stacked user → text → provenance → actions →
            video controls, so the media page reads as one composed screen on
            phones. Desktop keeps the floating bottom chrome below. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-30 transition-[opacity,visibility] duration-300 lg:hidden",
            !uiVisible && "invisible opacity-0"
          )}
        >
          <div className="bg-linear-to-t from-black/95 via-black/70 to-transparent px-3 pt-16 pb-3">
            {post ? (
              <div className="pointer-events-auto flex items-center gap-3">
                <Link
                  aria-label="View profile"
                  className="shrink-0 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-white/80"
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
                      className="block truncate font-semibold text-white hover:underline"
                      href={`/users/${post.user.username}`}
                    >
                      {post.user.displayName}
                    </Link>
                    <UserBadge
                      badge={post.user.badge}
                      badges={post.user.badges}
                    />
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
            ) : null}

            {post?.content ? (
              <div className="pointer-events-auto mt-2.5">
                <Linkify>
                  <p className="text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap text-white/90">
                    {post.content}
                  </p>
                </Linkify>
              </div>
            ) : null}

            {standalone &&
            currentMedia &&
            (currentMedia.aiGenerated || currentMedia.altText) ? (
              <div className="pointer-events-auto mt-2.5 flex flex-wrap items-start gap-2">
                <AiGeneratedBadge media={currentMedia} />
                {currentMedia.altText ? (
                  <div className="flex min-h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-linear-to-b from-zinc-500 to-zinc-700 px-2.5 py-1 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(35,35,40,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.25)]">
                    <span className="text-[10px] leading-none font-bold whitespace-nowrap">
                      ALT
                    </span>
                    <span className="min-w-0 text-[10px] leading-snug font-medium break-words">
                      {currentMedia.altText}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {post ? (
              <div className="pointer-events-auto mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <div className="flex items-center gap-2">
                  <button
                    aria-label="View eddies"
                    className={cn(
                      "flex h-11 items-center gap-1.5 rounded-full px-3.5 transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={() => router.push(`/posts/${post.id}`)}
                    type="button"
                  >
                    <MessageSquare
                      className={cn(
                        "size-4.5",
                        post._count.comments > 0 && "fill-current"
                      )}
                    />
                    <span className="text-sm font-semibold tabular-nums">
                      {post._count.comments}
                    </span>
                  </button>
                  <AuraVoteButton
                    authorName={post.user.displayName}
                    initialState={{
                      aura: post.aura,
                      userVote: post.vote[0]?.value || 0,
                    }}
                    postId={post.id}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <ShareButton
                    className="h-9 w-9"
                    description={post.content}
                    dialogDescription="Share this media with your network"
                    dialogTitle="Share Media"
                    postId={post.id}
                    shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/posts/${post.id}/media/${currentIndex}`}
                    thumbnail={getShareThumbnail(post, currentMedia)}
                    title={`${post.user.displayName || post.user.username} (@${post.user.username}) on asocialmedia`}
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
                </div>
              </div>
            ) : null}

            {currentMedia?.type === "VIDEO" ? (
              <div className="pointer-events-auto mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <div className="flex items-center gap-3">
                  <button
                    aria-label={
                      videoState.isPlaying ? "Pause video" : "Play video"
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-all hover:from-[#ff9f0a] hover:to-[#ea5b00] active:translate-y-px"
                    onClick={handleVideoPlayPause}
                    type="button"
                  >
                    {videoState.isPlaying ? (
                      <Pause className="size-5 fill-current" />
                    ) : (
                      <Play className="ml-0.5 size-5 fill-current" />
                    )}
                  </button>
                  <span className="text-sm font-medium text-white tabular-nums">
                    {formatPlaybackTime(videoState.currentTime)} /{" "}
                    {formatPlaybackTime(videoState.duration)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    aria-label={
                      videoState.isMuted ? "Unmute video" : "Mute video"
                    }
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={handleVideoToggleMute}
                    type="button"
                  >
                    {videoState.isMuted || videoState.volume === 0 ? (
                      <VolumeX className="size-5" />
                    ) : (
                      <Volume2 className="size-5" />
                    )}
                  </button>
                  <button
                    aria-label="Playback speed"
                    className={cn(
                      "flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm font-semibold transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={handleVideoCycleSpeed}
                    type="button"
                  >
                    {videoState.playbackRate}x
                  </button>
                  <button
                    aria-label="Fullscreen"
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={handleVideoFullscreen}
                    type="button"
                  >
                    <Maximize className="size-5" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom chrome overlays the media (with a scrim) instead of taking
            layout space, so the media area spans the full viewport height and
            the image centers dead-on vertically. The thumbnail strip stays in
            dialog galleries only; the standalone media page drops it. Desktop
            only - mobile uses the stacked bottom panel above. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-30 hidden flex-col bg-linear-to-t from-black/95 via-black/60 to-transparent pt-24 pb-1 transition-[opacity,visibility] duration-300 lg:flex",
            !uiVisible && "invisible opacity-0"
          )}
        >
          {!standalone &&
          media.length > 1 &&
          !post?.moderated &&
          !(post?.explicitContent && !explicitRevealed) ? (
            <div className="pointer-events-auto flex justify-center border-t border-white/10 px-3 py-2.5">
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

          {/* Attribution row, standalone page only - never on feed cards or
              dialog-mode galleries: AI-generated marker first, then the
              uploader's alt text in its own badge. */}
          {standalone &&
          currentMedia &&
          (currentMedia.aiGenerated || currentMedia.altText) ? (
            <div className="pointer-events-auto flex flex-wrap items-start gap-2 border-t border-white/10 px-4 py-3">
              <AiGeneratedBadge media={currentMedia} />
              {currentMedia.altText ? (
                <div className="flex min-h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-linear-to-b from-zinc-500 to-zinc-700 px-2.5 py-1 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(35,35,40,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.25)]">
                  <span className="text-[10px] leading-none font-bold whitespace-nowrap">
                    ALT
                  </span>
                  <span className="min-w-0 text-[10px] leading-snug font-medium break-words">
                    {currentMedia.altText}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {post ? (
            <div className="pointer-events-auto">{renderActionBar()}</div>
          ) : null}

          {/* Desktop video controls: the same arrangement as the mobile
              panel's control row (play + time left, mute/speed/fullscreen
              right) with a seek slider above it, sitting in the bottom chrome
              below the actions. The mobile panel's own row is lg:hidden. */}
          {currentMedia?.type === "VIDEO" && post ? (
            <div className="pointer-events-auto hidden flex-col gap-3 px-4 pt-3 pb-3 lg:flex">
              <Slider
                aria-label="Seek video"
                className="h-1.5 [&_[role=slider]]:opacity-0 [&>span:first-child]:bg-white/20 [&>span:first-child>span]:bg-linear-to-r [&>span:first-child>span]:from-[#ff9500] [&>span:first-child>span]:to-[#e65500]"
                max={videoState.duration || 0}
                min={0}
                onValueChange={handleVideoSeek}
                step={0.1}
                value={[videoState.currentTime]}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    aria-label={
                      videoState.isPlaying ? "Pause video" : "Play video"
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-all hover:from-[#ff9f0a] hover:to-[#ea5b00] active:translate-y-px"
                    onClick={handleVideoPlayPause}
                    type="button"
                  >
                    {videoState.isPlaying ? (
                      <Pause className="size-5 fill-current" />
                    ) : (
                      <Play className="ml-0.5 size-5 fill-current" />
                    )}
                  </button>
                  <span className="text-sm font-medium text-white tabular-nums">
                    {formatPlaybackTime(videoState.currentTime)} /{" "}
                    {formatPlaybackTime(videoState.duration)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    aria-label={
                      videoState.isMuted ? "Unmute video" : "Mute video"
                    }
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={handleVideoToggleMute}
                    type="button"
                  >
                    {videoState.isMuted || videoState.volume === 0 ? (
                      <VolumeX className="size-5" />
                    ) : (
                      <Volume2 className="size-5" />
                    )}
                  </button>
                  <button
                    aria-label="Playback speed"
                    className={cn(
                      "flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm font-semibold transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={handleVideoCycleSpeed}
                    type="button"
                  >
                    {videoState.playbackRate}x
                  </button>
                  <button
                    aria-label="Fullscreen"
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      MOBILE_CHIP_3D
                    )}
                    onClick={handleVideoFullscreen}
                    type="button"
                  >
                    <Maximize className="size-5" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {post ? (
        <aside className="hidden h-full w-[420px] flex-col border-l border-white/10 bg-[hsl(var(--background))] lg:flex">
          <div className="hide-native-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {/* The current post on the app's standard 3D subcard, composed
                like the post page: author header, content, media strip, meta
                and the feed's action row. */}
            <section className="sidebar-subcard rounded-2xl p-3">
              <div className="flex items-center gap-3">
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
                    <UserBadge
                      badge={post.user.badge}
                      badges={post.user.badges}
                    />
                  </span>
                  <Link
                    className="text-muted-foreground block truncate hover:underline"
                    href={`/users/${post.user.username}`}
                  >
                    @{post.user.username}
                  </Link>
                </div>
                {canModerate ? (
                  <PostMoreButton
                    className="shrink-0"
                    post={post}
                    variant="media-page"
                  />
                ) : null}
              </div>

              <div className="mt-2.5">
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
                {media.length > 0 && !post.moderated ? (
                  <div className="mt-3">
                    {post.explicitContent ? (
                      <ExplicitContentGate
                        revealKey={post.id}
                        className="h-full w-full"
                        compact
                        label="Explicit"
                      >
                        {renderSidebarMediaGrid()}
                      </ExplicitContentGate>
                    ) : (
                      renderSidebarMediaGrid()
                    )}
                  </div>
                ) : null}
              </div>

              <div className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
                {/* The timestamp is rendered in the viewer's local timezone,
                    which can differ between server and client, so hydration
                    is suppressed to avoid a mismatch on refresh. formatDate
                    keeps the shape deterministic across locales. */}
                <span suppressHydrationWarning>
                  {formatDate(new Date(post.createdAt), "d MMM yyyy")}
                </span>
                <span aria-hidden>·</span>
                <span suppressHydrationWarning>
                  {formatDate(new Date(post.createdAt), "h:mm a")}
                </span>
              </div>

              {/* Feed-style action row: eddies + aura left, views + share +
                  bookmark right, exactly like the post card. */}
              <div className="mt-3 flex items-center gap-1 border-t border-white/10 pt-3">
                <button
                  aria-label="View eddies"
                  className="pill-3d-hover group text-muted-foreground inline-flex h-8 items-center justify-center gap-1 rounded-full border-0 px-2 text-sm font-medium active:translate-y-px"
                  onClick={() => router.push(`/posts/${post.id}`)}
                  type="button"
                >
                  <MessageSquare
                    className={cn(
                      "size-5",
                      post._count.comments > 0 && "fill-current"
                    )}
                  />
                  <span className="text-sm font-medium tabular-nums">
                    {post._count.comments}
                  </span>
                </button>
                <AuraVoteButton
                  authorName={post.user.displayName}
                  initialState={{
                    aura: post.aura,
                    userVote: post.vote[0]?.value || 0,
                  }}
                  postId={post.id}
                />
                <div className="flex-1" />
                <span
                  className="text-muted-foreground flex h-8 cursor-default items-center gap-1.5 rounded-full px-2"
                  title="Views"
                >
                  <Eye className="size-5" />
                  <span className="text-sm tabular-nums">
                    {formatNumber(post.viewCount)}
                  </span>
                </span>
                <ShareButton
                  className="h-9 w-9"
                  description={post.content}
                  dialogDescription="Share this media with your network"
                  dialogTitle="Share Media"
                  postId={post.id}
                  shareUrl={`${typeof window === "undefined" ? "" : window.location.origin}/posts/${post.id}/media/${currentIndex}`}
                  thumbnail={getShareThumbnail(post, currentMedia)}
                  title={`${post.user.displayName || post.user.username} (@${post.user.username}) on asocialmedia`}
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
              </div>
            </section>

            {/* The eddie thread on its own subcard. */}
            <section className="sidebar-subcard rounded-2xl p-3">
              <Comments post={post} />
            </section>

            {/* Related content on the same surface as every other sidebar
                list (post-author sidebar, trending, ...). */}
            <section className="sidebar-subcard rounded-2xl p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
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
            </section>
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
