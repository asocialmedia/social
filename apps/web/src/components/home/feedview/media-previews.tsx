// oxlint-disable react-compiler -- thumbnail components use local hooks/state that the React
// Compiler would otherwise try to memoize across parent renders

import type { Media, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  Pause,
  Play,
  VolumeX,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";

import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";
import { withViewTransition } from "@/lib/view-transition";

// eslint-disable-next-line import/no-cycle -- media-previews renders inside post-card while the media viewer shows related posts via post-card
import MediaViewer from "./media-viewer";

interface MediaPreviewsProps {
  attachments: Media[];
  autoPlayVideos?: boolean;
  initialMediaIndex?: number;
  interactive?: boolean;
  post?: PostData;
}

// Top-level component (not nested) so its own hover/play state doesn't cause
// the parent grid to re-render and remount the <video> element mid-playback.
const VIDEO_HOVER_DELAY = 350;

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

function formatTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) {
    return "0:00";
  }
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Resolves a media item's natural aspect ratio (when stored) so the single
// featured image can preserve true proportions instead of shrinking to a
// corner tile on mobile.
function mediaAspectRatio(media: Media, fallback = "1 / 1"): string {
  const w =
    typeof media.width === "number" && media.width > 0 ? media.width : null;
  const h =
    typeof media.height === "number" && media.height > 0 ? media.height : null;
  return w && h ? `${w} / ${h}` : fallback;
}

const getCommonClasses = (isSmall: boolean) =>
  cn(
    "mx-auto w-full rounded-lg object-cover transition-transform duration-300 group-hover:scale-105",
    isSmall ? "aspect-square" : "aspect-square sm:h-72"
  );

const GridImagePreview = ({
  isSmall,
  media,
}: {
  isSmall: boolean;
  media: Media;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  if (isFailed) {
    return (
      <div
        className={cn(
          "bg-muted/20 relative w-full overflow-hidden rounded-lg",
          isSmall ? "aspect-square" : "aspect-square sm:h-72"
        )}
      >
        <Image
          alt="Attachment unavailable"
          className="h-full w-full object-cover opacity-60"
          fill
          sizes="(max-width: 768px) 50vw, 33vw"
          src={noMediaImage}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group bg-muted/20 relative w-full overflow-hidden rounded-lg",
        isSmall ? "aspect-square" : "aspect-square sm:h-72"
      )}
    >
      {isLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      <Image
        alt="Attachment"
        className={cn(
          getCommonClasses(isSmall),
          "transition-opacity duration-300",
          isLoading ? "opacity-0" : "opacity-100"
        )}
        fill
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        // Mobile grid is 2 columns, desktop is 3; match the rendered column
        // width so the browser picks an appropriately-sized image.
        sizes="(max-width: 768px) 50vw, 33vw"
        src={getMediaUrl(media.id)}
        style={{ objectFit: "cover" }}
      />
      <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
    </div>
  );
};

const renderFilePreview = (
  m: Media,
  isSmall: boolean,
  icon: React.ReactNode
) => (
  <div className="relative w-full">
    <div
      className={cn(
        "bg-primary/5 h-full w-full rounded-lg p-4 transition-transform duration-300 group-hover:scale-105",
        isSmall ? "" : "min-h-40"
      )}
    >
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className={cn("text-primary", isSmall ? "h-6 w-6" : "h-12 w-12")}>
          {icon}
        </div>
        {!isSmall && (
          <p className="max-w-full truncate text-sm font-medium">
            {formatFileName(m.key)}
          </p>
        )}
      </div>
    </div>
  </div>
);

const renderCodePreview = (m: Media, isSmall: boolean) => (
  <div className="relative w-full">
    <div
      className={cn(
        "bg-primary/5 h-full w-full rounded-lg p-4 transition-transform duration-300 group-hover:scale-105",
        isSmall ? "" : "min-h-40"
      )}
    >
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <FileCode
          className={cn("text-primary", isSmall ? "h-6 w-6" : "h-12 w-12")}
        />
        {!isSmall && (
          <div className="flex flex-col items-center">
            <p className="max-w-full truncate text-sm font-medium">
              {formatFileName(m.key)}
            </p>
            <p className="text-muted-foreground text-xs">
              {getLanguageFromFileName(m.key)}
            </p>
          </div>
        )}
      </div>
    </div>
  </div>
);

const VideoPreview = ({
  autoPlay = false,
  media,
}: {
  autoPlay?: boolean;
  media: Media;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);
  const previewStartedRef = useRef(false);
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  // Set when the poster or the video itself fails to load, so a broken clip
  // shows the nomedia placeholder instead of an empty black tile.
  const [isFailed, setIsFailed] = useState(false);
  // Minimal hover controls: playback state, current time and clip duration.
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const getExpandedHeight = useCallback((): number | null => {
    const container = containerRef.current;
    const video = container?.querySelector("video");
    if (container && video && video.videoWidth > 0 && video.videoHeight > 0) {
      const naturalHeight =
        (container.clientWidth * video.videoHeight) / video.videoWidth;
      return Math.min(naturalHeight, window.innerHeight * 0.75);
    }
    return null;
  }, []);

  const startPreview = useCallback(() => {
    previewStartedRef.current = true;
    const video = containerRef.current?.querySelector("video");
    if (video) {
      void (async () => {
        try {
          await video.play();
        } catch {
          // Autoplay may be blocked or aborted by user navigation; ignore safely
        }
      })();
    }
    const height = getExpandedHeight();
    if (height !== null) {
      setExpandedHeight(height);
    }
  }, [getExpandedHeight]);

  const handleMouseEnter = useCallback(() => {
    if (autoPlay) {
      return;
    }
    setIsHovered(true);
    isHoveredRef.current = true;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      startPreview();
    }, VIDEO_HOVER_DELAY);
  }, [autoPlay, startPreview]);

  const handleMouseLeave = useCallback(() => {
    if (autoPlay) {
      return;
    }
    setIsHovered(false);
    isHoveredRef.current = false;
    previewStartedRef.current = false;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const video = containerRef.current?.querySelector("video");
    if (video) {
      try {
        video.pause();
        if (video.readyState >= 1 && video.duration > 2) {
          video.currentTime = 2;
        }
      } catch {
        // Ignore pause/seek aborts
      }
    }
    setExpandedHeight(null);
    setIsVideoActive(false);
  }, [autoPlay]);

  const handlePlaying = useCallback(() => {
    setIsVideoActive(true);
  }, []);

  const handleTimeUpdate = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      setCurrentTime(event.currentTarget.currentTime);
    },
    []
  );

  const handleDurationChange = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      if (Number.isFinite(event.currentTarget.duration)) {
        setDuration(event.currentTarget.duration);
      }
    },
    []
  );

  const handleVideoPlay = useCallback(() => setIsPlaying(true), []);
  const handleVideoPause = useCallback(() => setIsPlaying(false), []);

  const handlePosterError = useCallback(() => {
    setIsFailed(true);
    setIsVideoActive(false);
  }, []);

  const handleVideoError = useCallback(() => {
    setIsFailed(true);
    setIsVideoActive(false);
  }, []);

  // Toggle playback from the hover controls. Stops propagation so the tile's
  // "open media viewer" click never fires while using the control.
  const togglePlayback = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault();
      event.stopPropagation();
      const video = containerRef.current?.querySelector("video");
      if (!video) {
        return;
      }
      if (video.paused) {
        void (async () => {
          try {
            await video.play();
          } catch {
            // Autoplay may be blocked; ignore safely
          }
        })();
      } else {
        video.pause();
      }
    },
    []
  );

  const handleLoadedMetadata = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (!autoPlay && video.duration > 2) {
        try {
          video.currentTime = 2;
        } catch {
          // Ignore seek aborts
        }
      }
      if (previewStartedRef.current) {
        const height = getExpandedHeight();
        if (height !== null) {
          setExpandedHeight(height);
        }
        if (autoPlay) {
          void (async () => {
            try {
              await video.play();
            } catch {
              // Autoplay may be blocked or aborted; ignore
            }
          })();
        }
      }
    },
    [autoPlay, getExpandedHeight]
  );

  useEffect(
    () => () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (autoPlay) {
      startPreview();
    }
  }, [autoPlay, startPreview]);

  if (isFailed) {
    return (
      <div
        className="bg-muted/20 relative w-full overflow-hidden rounded-lg"
        style={{ aspectRatio: mediaAspectRatio(media, "16 / 9") }}
      >
        <Image
          alt="Video unavailable"
          className="h-full w-full object-cover opacity-60"
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          src={noMediaImage}
        />
      </div>
    );
  }

  return (
    <div
      className="group relative w-full overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={containerRef}
      style={
        expandedHeight === null
          ? { aspectRatio: mediaAspectRatio(media, "16 / 9") }
          : { height: expandedHeight }
      }
    >
      <video
        className="absolute inset-0 h-full w-full rounded-lg object-cover"
        muted
        onDurationChange={handleDurationChange}
        onError={handleVideoError}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={handleVideoPause}
        onPlay={handleVideoPlay}
        onPlaying={handlePlaying}
        onTimeUpdate={handleTimeUpdate}
        playsInline
        preload={autoPlay ? "metadata" : "none"}
        src={isHovered || autoPlay ? getMediaUrl(media.id) : undefined}
      />
      <Image
        alt="Video preview"
        className={cn(
          "absolute inset-0 h-full w-full rounded-lg object-cover transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          isVideoActive ? "opacity-0" : "opacity-100"
        )}
        fill
        loading="eager"
        onError={handlePosterError}
        sizes="(max-width: 768px) 100vw, 640px"
        src={getMediaProxyUrl(media)}
        unoptimized
      />
      <div
        className={cn(
          "absolute top-2 right-2 transition-opacity duration-300",
          expandedHeight === null ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          <MdPlayArrow className="ml-0.5 h-3.5 w-3.5 text-white" />
        </div>
      </div>
      <div
        className={cn(
          "absolute bottom-2 left-2 flex h-7 items-center gap-1.5 rounded-full bg-linear-to-b from-[#3a3f4a] to-[#23262e] px-2 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_6px_rgba(0,0,0,0.35)] transition-opacity duration-300",
          autoPlay ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        role="status" // eslint-disable-line jsx-a11y/prefer-tag-over-role -- status badge overlaid on the video
      >
        <VolumeX className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Muted</span>
      </div>

      {/* Minimal hover controls: play/pause + time, shown as two separate
          floating elements so they read independently. Rendered as divs (not a
          <button>) because the whole preview sits inside the tile's "open
          media viewer" <button>; nesting a button would be invalid HTML and
          break hydration. Opaque 3D surfaces matching the app's button
          language. Clicks are swallowed so they never bubble to the tile and
          open the viewer. */}
      {/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/prefer-tag-over-role -- the play/pause control (and its click-swallowing surface) must not be a <button> because the whole preview sits inside the tile's "open media viewer" <button>; nesting a button would be invalid HTML and break hydration */}
      <div
        aria-label={isPlaying ? "Pause" : "Play"}
        className={cn(
          "absolute right-2 bottom-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.25)] transition-all duration-200 hover:from-[#ff9f0a] hover:to-[#ea5b00] active:translate-y-px",
          autoPlay ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        onClick={togglePlayback}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            togglePlayback(event);
          }
        }}
        role="button"
        tabIndex={-1}
      >
        {isPlaying ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="ml-0.5 h-3.5 w-3.5" />
        )}
      </div>
      {/* oxlint-enable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/prefer-tag-over-role */}
      <div
        className={cn(
          "pointer-events-none absolute right-2 bottom-11 z-10 flex h-5 items-center rounded-md bg-linear-to-b from-[#3a3f4a] to-[#23262e] px-1.5 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_6px_rgba(0,0,0,0.35)] transition-opacity duration-300",
          autoPlay ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <span className="text-[10px] font-medium tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-linear-to-t from-black/50 via-transparent to-transparent opacity-40 transition-all duration-300 group-hover:opacity-20" />
    </div>
  );
};

// A single (un-dimensioned) image fills the full column width on every screen
// while preserving its natural aspect ratio, so rectangles no longer sit small
// and centered and squares don't shrink to a corner tile on mobile.
const SingleImagePreview = ({
  interactive,
  media,
  onSelect,
}: {
  interactive: boolean;
  media: Media;
  onSelect: () => void;
}) => {
  const storedW =
    typeof media.width === "number" && media.width > 0 ? media.width : null;
  const storedH =
    typeof media.height === "number" && media.height > 0 ? media.height : null;
  const hasStoredDims = storedW !== null && storedH !== null;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    hasStoredDims ? { h: storedH, w: storedW } : null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  useEffect(() => {
    if (hasStoredDims) {
      return;
    }
    if (natural) {
      return;
    }
    const img = new window.Image();
    const handleLoad = () => {
      if (img.naturalWidth > 0) {
        setNatural({ h: img.naturalHeight, w: img.naturalWidth });
      }
    };
    img.addEventListener("load", handleLoad);
    img.src = getMediaUrl(media.id);
    return () => {
      img.removeEventListener("load", handleLoad);
    };
  }, [media.id, natural, hasStoredDims]);

  const dims = natural;

  if (isFailed) {
    return (
      <div className="bg-muted/20 relative flex max-h-[500px] w-full items-center justify-center overflow-hidden rounded-xl">
        <Image
          alt="Attachment unavailable"
          className="h-auto max-h-[500px] w-full object-contain opacity-60"
          height={600}
          sizes="(max-width: 768px) 100vw, 640px"
          src={noMediaImage}
          width={640}
        />
      </div>
    );
  }

  // Sizes at the photo's natural ratio: landscape fills the column width,
  // portrait is capped in height and pinned to the left (not centered) so it
  // doesn't stretch the feed into a huge frame or float awkwardly.
  const isPortrait = Boolean(dims && dims.h > dims.w);
  const previewContent = (
    <div
      className={cn(
        "bg-muted/20 relative block overflow-hidden rounded-xl shadow-xs transition-shadow duration-300 hover:shadow-md",
        // Portrait images are height-capped and left-pinned, so shrink-wrap
        // the frame to the image width instead of forcing w-full. Otherwise the
        // container's bg fills the gap to the right and clashes with the post
        // card's background.
        isPortrait ? "w-fit max-w-full" : "w-full"
      )}
    >
      {isLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse rounded-xl" />
      ) : null}
      <Image
        alt="Attachment"
        className={cn(
          "rounded-xl object-contain transition-opacity duration-300",
          isPortrait
            ? "h-auto max-h-[72vh] w-auto max-w-full"
            : "h-auto w-full",
          isLoading ? "opacity-0" : "opacity-100"
        )}
        height={dims?.h ?? 600}
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        sizes="(max-width: 768px) 100vw, 640px"
        src={getMediaUrl(media.id)}
        width={dims?.w ?? 640}
      />
    </div>
  );

  return interactive ? (
    <button
      aria-label="View attachment"
      className="block w-full cursor-pointer text-left"
      onClick={onSelect}
      type="button"
    >
      {previewContent}
    </button>
  ) : (
    <div>{previewContent}</div>
  );
};

export const MediaPreviews = ({
  attachments,
  autoPlayVideos = false,
  interactive = true,
  post,
  initialMediaIndex,
}: MediaPreviewsProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialMediaIndex ?? null
  );
  const [showAll, setShowAll] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // When a post is present the viewer lives at a shareable route
  // (/posts/{postId}/media/{index}); otherwise (e.g. profile gallery) it is
  // driven by local state only.
  const router = useRouter();

  const handleShowAll = useCallback(() => {
    setShowAll(true);
  }, []);

  const handleShowLess = useCallback(() => {
    setShowAll(false);
  }, []);

  const handleCloseViewer = useCallback(() => {
    if (post) {
      // The media URL was pushed on top of the post page, so closing the viewer
      // should pop it with back() - that returns to the post page in one step
      // without leaving a duplicate entry behind (which would make the top-left
      // back button need multiple presses). Fall back to replace for direct
      // loads where there is no prior entry to pop.
      if (typeof window !== "undefined" && window.history.length > 1) {
        withViewTransition(() => router.back());
      } else {
        withViewTransition(() => router.replace(`/posts/${post.id}`));
      }
      return;
    }
    setSelectedIndex(null);
  }, [post, router]);

  const openAtIndex = useCallback(
    (index: number) => {
      if (post) {
        withViewTransition(() =>
          router.push(`/posts/${post.id}/media/${index}`)
        );
        return;
      }
      setSelectedIndex(index);
    },
    [post, router]
  );

  const handleNavigateIndex = useCallback(
    (index: number) => {
      if (post) {
        // Update the URL in place so the shared link tracks the viewed asset.
        withViewTransition(() =>
          router.replace(`/posts/${post.id}/media/${index}`)
        );
        return;
      }
      setSelectedIndex(index);
    },
    [post, router]
  );

  const initialCount = isMobile ? 2 : 3;
  const visibleAttachments =
    !interactive || showAll ? attachments : attachments.slice(0, initialCount);
  const remainingAttachments = attachments.slice(initialCount);
  const remainingCount = attachments.length - initialCount;

  const renderImagePreview = (m: Media, isSmall: boolean) => {
    if (m.mimeType === "image/svg+xml") {
      return (
        <div className="group relative w-full">
          <object
            className={cn(
              "mx-auto w-full rounded-lg transition-transform duration-300 group-hover:scale-105",
              isSmall ? "aspect-square" : "aspect-square"
            )}
            data={getMediaUrl(m.id)}
            type="image/svg+xml"
          >
            <Image
              alt="Attachment unavailable"
              className="h-full w-full object-cover opacity-60"
              fill
              sizes="(max-width: 768px) 50vw, 33vw"
              src={noMediaImage}
            />
          </object>
          <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
        </div>
      );
    }
    return <GridImagePreview isSmall={isSmall} media={m} />;
  };

  const renderPreview = (m: Media, _index: number, isSmall = false) => {
    switch (m.type) {
      case "IMAGE": {
        return renderImagePreview(m, isSmall);
      }
      case "VIDEO": {
        return <VideoPreview autoPlay={autoPlayVideos} media={m} />;
      }
      case "AUDIO": {
        return renderFilePreview(m, isSmall, <FileAudioIcon />);
      }
      case "CODE": {
        return renderCodePreview(m, isSmall);
      }
      case "DOCUMENT": {
        return renderFilePreview(m, isSmall, <FileIcon />);
      }
      default: {
        return null;
      }
    }
  };

  const handleSelectImage = useCallback(
    (index: number) => () => openAtIndex(index),
    [openAtIndex]
  );

  // These "preview card" components are declared at module scope (not nested)
  // so their identity is stable across parent re-renders. Nested definitions
  // would give them a fresh type on every MediaPreviews render, forcing React
  // to unmount and remount each thumbnail (and reload its image) whenever the
  // feed refreshes — the source of the images "blinking" mid-scroll.
  const renderSingleImage = (m: Media, index: number) => (
    <SingleImagePreview
      key={m.id}
      interactive={interactive}
      media={m}
      onSelect={handleSelectImage(index)}
    />
  );

  const renderGridTile = (m: Media, index: number, size: "small" | "large") => {
    const isSmall = size === "small";
    const handleSelect = () => openAtIndex(index);
    // Videos (and a lone media item) size themselves via their own natural
    // aspect ratio, so don't force a square/tall crop that squeezes them.
    // Small tiles stay square for a tidy grid; large image tiles use a square
    // crop on mobile and a tall crop on desktop.
    // Videos size themselves via their own natural aspect ratio, so don't force
    // a square/tall crop on them. Images (and small tiles) keep a tidy crop.
    const wrapperHeightClass =
      !isSmall && m.type === "VIDEO" ? "h-auto" : "aspect-square sm:h-72";

    return (
      <button
        aria-label="View attachment"
        className={cn(
          "relative block w-full cursor-pointer overflow-hidden rounded-lg p-0 text-left shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
          wrapperHeightClass
        )}
        data-card-interactive
        key={m.id}
        onClick={handleSelect}
        type="button"
      >
        {renderPreview(m, index, isSmall)}
      </button>
    );
  };

  const renderGridCell = (
    m: Media,
    index: number,
    size: "small" | "large" = "large"
  ) => (
    <div className="relative overflow-hidden rounded-lg shadow-xs" key={m.id}>
      {renderPreview(m, index, size === "small")}
    </div>
  );

  const renderShowMoreSection = () => {
    if (isMobile) {
      return (
        <div className="px-4 pb-4">
          <div className="bg-primary/5 relative w-full overflow-hidden rounded-lg p-4 shadow-xs transition-all duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {remainingCount} more items
                </p>
                <Button onClick={handleShowAll} size="sm" variant="secondary">
                  Show All
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {remainingAttachments.map((m, index) =>
                  renderGridTile(m, index + initialCount, "small")
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="px-4 pb-4">
        <button
          aria-label="Show all media"
          className="bg-primary/5 hover:bg-primary/10 relative w-full cursor-pointer overflow-hidden rounded-lg shadow-xs transition-all duration-300 hover:shadow-md"
          onClick={handleShowAll}
          type="button"
        >
          <div className="flex h-32 items-center justify-between p-4">
            <div className="flex items-center gap-4">
              {remainingAttachments.slice(0, 2).map((m, index) => (
                <div
                  className="relative h-24 w-24 overflow-hidden rounded-lg"
                  key={m.id}
                >
                  {renderPreview(m, index + initialCount)}
                  <div className="absolute inset-0 bg-black/10" />
                </div>
              ))}
            </div>

            <div className="flex flex-col items-end gap-2 pr-4">
              <p className="text-lg font-medium">Show {remainingCount} more</p>
              <Button variant="secondary">Expand</Button>
            </div>
          </div>
        </button>
      </div>
    );
  };

  // On mobile the first attachment is rendered as a full-width featured card
  // (so a rectangle isn't squeezed into a half-width crop it doesn't fill) and
  // the rest tile below it in a 2-column grid. Desktop keeps a uniform grid.
  const [first, ...rest] = visibleAttachments;

  const renderFirstAttachment = () => {
    if (!first) {
      return null;
    }
    if (first.type === "IMAGE" && first.mimeType !== "image/svg+xml") {
      return renderSingleImage(first, 0);
    }
    if (interactive) {
      return renderGridTile(first, 0, "large");
    }
    return renderGridCell(first, 0);
  };

  return (
    <div className="w-full">
      {isMobile && first ? (
        <div className="mb-4 w-full">{renderFirstAttachment()}</div>
      ) : null}

      <div
        className={cn(
          "grid gap-4",
          (() => {
            if (isMobile) {
              return "grid-cols-2";
            }
            if (visibleAttachments.length === 1) {
              return "grid-cols-1";
            }
            if (visibleAttachments.length === 2) {
              return "grid-cols-2";
            }
            return "grid-cols-3";
          })()
        )}
      >
        {(isMobile ? rest : visibleAttachments).map((m, index) => {
          const isSingleImage =
            visibleAttachments.length === 1 &&
            m.type === "IMAGE" &&
            m.mimeType !== "image/svg+xml";
          if (isSingleImage) {
            return renderSingleImage(m, index);
          }
          const tileIndex = isMobile ? index + 1 : index;
          if (interactive) {
            return renderGridTile(m, tileIndex, "large");
          }
          return renderGridCell(m, tileIndex);
        })}
      </div>

      {interactive &&
        !showAll &&
        attachments.length > initialCount &&
        renderShowMoreSection()}

      {interactive && showAll ? (
        <div className="flex justify-center pb-4">
          <Button
            onClick={handleShowLess}
            size={isMobile ? "sm" : "default"}
            variant="ghost"
          >
            Show Less
          </Button>
        </div>
      ) : null}

      {interactive && selectedIndex !== null && (
        <MediaViewer
          initialIndex={selectedIndex}
          isOpen={selectedIndex !== null}
          media={attachments}
          onClose={handleCloseViewer}
          onNavigate={handleNavigateIndex}
          post={post}
        />
      )}
    </div>
  );
};
