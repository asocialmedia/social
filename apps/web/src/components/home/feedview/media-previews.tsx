// oxlint-disable react-compiler -- thumbnail components use local hooks/state that the React
// Compiler would otherwise try to memoize across parent renders
// oxlint-disable react/exhaustive-effect-dependencies -- cached image checks use media.id intentionally

import type { Media, PostData } from "@asm/db";
import noMediaImage from "@assets/general/nomedia.png";
import {
  ChevronDown,
  ChevronUp,
  FileAudioIcon,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";

import { AiGeneratedBadge } from "@/components/media/ai-generated-badge";
import { parseWebVttCues } from "@/components/media/video-transcript-drawer";
import type { TranscriptCue } from "@/components/media/video-transcript-drawer";
import { useAltRevealed } from "@/lib/alt-reveal-store";
import { cn } from "@/lib/utils";
import {
  getMediaImageSrcSet,
  getMediaImageUrl,
  getMediaProxyUrl,
  getMediaVideoUrl,
} from "@/lib/utils/image-url";
import { useVideoCaptionsStore } from "@/lib/video-captions-store";
import { useVideoMuteStore } from "@/lib/video-mute-store";
import { withViewTransition } from "@/lib/view-transition";

import { AudioPreview } from "./audio-preview";
// eslint-disable-next-line import/no-cycle -- media-previews renders inside post-card while the media viewer shows related posts via post-card
import MediaViewer from "./media-viewer";

interface MediaPreviewsProps {
  attachments: Media[];
  autoPlayVideos?: boolean;
  // Renders the mobile layout regardless of the actual viewport (used in
  // narrow embedded columns like the media page's sidebar, where the desktop
  // grids would be cramped).
  forceMobile?: boolean;
  initialMediaIndex?: number;
  interactive?: boolean;
  post?: PostData;
}

// Top-level component (not nested) so its own hover/play state doesn't cause
// the parent grid to re-render and remount the <video> element mid-playback.
const VIDEO_HOVER_DELAY = 350;

// Feed bento layouts: 3-5 attachments render in one composed grid with no
// "Show all" collapse. The first attachment is always the tall left tile and
// the rest fill the right side. 6+ keeps the collapsible uniform grid.
const FEED_BENTO_LAYOUTS: Record<number, { cols: string; spans: string[] }> = {
  3: { cols: "grid-cols-2", spans: ["row-span-2", "", ""] },
  4: { cols: "grid-cols-3", spans: ["row-span-2", "col-span-2", "", ""] },
  5: { cols: "grid-cols-3", spans: ["row-span-2", "", "", "", ""] },
};

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

const getCommonClasses = (isSmall: boolean, isMobile: boolean) =>
  cn(
    "mx-auto w-full rounded-lg object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.02]",
    isSmall || isMobile ? "aspect-square" : "aspect-square sm:h-72"
  );

// Bento tiles load images behind an internal skeleton and fade them in, so
// grouped posts never show blank tiles that pop in when the bytes land.
// Mirrors GridImagePreview's loading treatment but fills the bento cell.
const BentoImagePreview = ({ media }: { media: Media }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  // Handle cached images that are already complete before onLoad fires.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setIsLoading(false);
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- media.id is stable, media object identity triggers correctly
  }, [media.id]);

  if (isFailed) {
    return (
      <div className="bg-muted/20 relative h-full w-full overflow-hidden">
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
    <div className="relative h-full w-full">
      {isLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- bento tiles use direct proxy URL with srcSet */}
      <img
        alt="Attachment"
        className={cn(
          "h-full w-full object-cover",
          isLoading ? "opacity-0" : "asm-media-reveal"
        )}
        decoding="async"
        loading="lazy"
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        ref={imgRef}
        sizes="(max-width: 768px) 50vw, 33vw"
        src={getMediaProxyUrl(media)}
        srcSet={getMediaImageSrcSet(media)}
        style={
          (media as unknown as { blurDataUrl?: string | null }).blurDataUrl
            ? {
                backgroundImage: `url(${(media as unknown as { blurDataUrl?: string | null }).blurDataUrl})`,
                backgroundSize: "cover",
                objectFit: "cover",
              }
            : { objectFit: "cover" }
        }
      />
    </div>
  );
};

const GridImagePreview = ({
  isMobile,
  isSmall,
  media,
}: {
  isMobile: boolean;
  isSmall: boolean;
  media: Media;
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  // Handle cached images that are already complete before onLoad fires.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setIsLoading(false);
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- media.id is stable, media object identity triggers correctly
  }, [media.id]);

  if (isFailed) {
    return (
      <div
        className={cn(
          "bg-muted/20 relative w-full overflow-hidden rounded-lg",
          isSmall || isMobile ? "aspect-square" : "aspect-square sm:h-72"
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
        isSmall || isMobile ? "aspect-square" : "aspect-square sm:h-72"
      )}
    >
      {isLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- srcSet is required for responsive delivery; Next Image does not expose it with unoptimized proxy URLs */}
      <img
        alt="Attachment"
        className={cn(
          getCommonClasses(isSmall, isMobile),
          "absolute inset-0 h-full w-full object-cover",
          isLoading ? "opacity-0" : "asm-media-reveal"
        )}
        decoding="async"
        loading="lazy"
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        ref={imgRef}
        sizes="(max-width: 768px) 50vw, 33vw"
        src={getMediaProxyUrl(media)}
        srcSet={getMediaImageSrcSet(media)}
        style={{ objectFit: "cover" }}
      />
      <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
      <AiGeneratedBadge
        className="absolute bottom-2 left-2 z-10"
        media={media}
      />
    </div>
  );
};

export const VideoPreview = ({
  autoPlay = false,
  fill = false,
  media,
}: {
  autoPlay?: boolean;
  /** Stretch to the parent box (uniform grid cells) instead of sizing by
   * natural aspect - the parent supplies width AND height, video covers. */
  fill?: boolean;
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
  // Feed clips autoplay muted, but the mute preference is shared globally
  // (feed -> post page -> media viewer) via the video mute store.
  const isMuted = useVideoMuteStore((state) => state.isMuted);
  const setMuted = useVideoMuteStore((state) => state.setMuted);
  const showCaptions = useVideoCaptionsStore((state) => state.showCaptions);
  const [fetchedCues, setFetchedCues] = useState<TranscriptCue[]>([]);

  const parsedDirectCues = useMemo(() => {
    if (!media.transcript) {
      return [];
    }
    if (media.transcript.includes("-->")) {
      return parseWebVttCues(media.transcript);
    }
    return [];
  }, [media.transcript]);

  const cues = parsedDirectCues.length > 0 ? parsedDirectCues : fetchedCues;

  useEffect(() => {
    if (
      showCaptions &&
      (isHovered || autoPlay || isVideoActive) &&
      cues.length === 0
    ) {
      let cancelled = false;
      const loadCaptions = async () => {
        try {
          const res = await fetch(`/api/media/${media.id}?captions=1`);
          if (res.ok) {
            const vtt = await res.text();
            if (!cancelled && vtt) {
              const parsed = parseWebVttCues(vtt);
              if (parsed.length > 0) {
                setFetchedCues(parsed);
              } else if (media.transcript) {
                const lines = media.transcript
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean);
                let t = 0;
                const generated: TranscriptCue[] = lines.map((line) => {
                  const dur = Math.max(3, line.split(/\s+/).length * 0.4);
                  const cue = { end: t + dur, start: t, text: line };
                  t += dur;
                  return cue;
                });
                setFetchedCues(generated);
              }
            }
          }
        } catch {
          // Ignore network errors
        }
      };
      void loadCaptions();
      return () => {
        cancelled = true;
      };
    }
  }, [
    showCaptions,
    isHovered,
    autoPlay,
    isVideoActive,
    media.id,
    media.transcript,
    cues.length,
  ]);

  const activeCue = useMemo(() => {
    if (!showCaptions || cues.length === 0) {
      return null;
    }
    return (
      cues.find((c) => currentTime >= c.start && currentTime <= c.end) ?? null
    );
  }, [showCaptions, cues, currentTime]);

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

  // Marks the preview as started and kicks off playback without touching
  // layout state; the expanded height is applied from event handlers
  // (handleLoadedMetadata) once the clip reports its dimensions.
  const beginPreview = useCallback(() => {
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
  }, []);

  const startPreview = useCallback(() => {
    beginPreview();
    const height = getExpandedHeight();
    if (height !== null) {
      setExpandedHeight(height);
    }
  }, [beginPreview, getExpandedHeight]);

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

  // Toggle sound from the "Muted" badge. Stops propagation so the tile's
  // "open media viewer" click never fires while using the control. The video
  // element's muted flag is the source of truth; the store carries the
  // preference across surfaces.
  const toggleMute = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault();
      event.stopPropagation();
      const video = containerRef.current?.querySelector("video");
      if (!video) {
        return;
      }
      const next = !video.muted;
      video.muted = next;
      setMuted(next);
    },
    [setMuted]
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
      const video = containerRef.current?.querySelector("video");
      if (video) {
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch {
          // Ignore
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!autoPlay) {
      return;
    }
    // Kick the preview off one frame later so the expanded-height state
    // update stays off the effect's synchronous path; the clip itself starts
    // essentially immediately.
    const frame = requestAnimationFrame(() => {
      startPreview();
    });
    return () => cancelAnimationFrame(frame);
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

  let containerStyle: React.CSSProperties | undefined;
  if (fill) {
    containerStyle = undefined;
  } else if (expandedHeight === null) {
    containerStyle = { aspectRatio: mediaAspectRatio(media, "16 / 9") };
  } else {
    containerStyle = { height: expandedHeight };
  }

  return (
    <div
      className={cn(
        "group overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
        fill ? "absolute inset-0 h-full w-full" : "relative w-full"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={containerRef}
      style={containerStyle}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- feed previews have no caption tracks; captions exist on the media page player */}
      <video
        className="absolute inset-0 h-full w-full rounded-lg object-cover"
        muted={isMuted}
        onDurationChange={handleDurationChange}
        onError={handleVideoError}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={handleVideoPause}
        onPlay={handleVideoPlay}
        onPlaying={handlePlaying}
        onTimeUpdate={handleTimeUpdate}
        playsInline
        preload={autoPlay ? "metadata" : "none"}
        src={isHovered || autoPlay ? getMediaVideoUrl(media.id) : undefined}
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
      {/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/prefer-tag-over-role -- the mute toggle must not be a <button> because the whole preview sits inside the tile's "open media viewer" <button>; nesting a button would be invalid HTML and break hydration */}
      <div
        aria-label={isMuted ? "Unmute" : "Mute"}
        className={cn(
          "absolute bottom-2 left-2 z-10 flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-linear-to-b from-[#3a3f4a] to-[#23262e] px-2 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_6px_rgba(0,0,0,0.35)] transition-all duration-200 hover:brightness-110 active:translate-y-px",
          autoPlay ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        onClick={toggleMute}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            toggleMute(event);
          }
        }}
        role="button"
        tabIndex={-1}
      >
        {isMuted ? (
          <VolumeX className="h-3.5 w-3.5" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
        <span className="text-xs font-medium">
          {isMuted ? "Muted" : "Sound"}
        </span>
      </div>
      {/* oxlint-enable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/prefer-tag-over-role */}

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
      {/* Always visible (unlike the hover pills) so provenance never hides. */}
      <AiGeneratedBadge
        className="absolute bottom-11 left-2 z-10"
        media={media}
      />

      {/* Live Floating Caption on feed card */}
      {showCaptions &&
      activeCue &&
      (isVideoActive || isPlaying || isHovered) ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-12 z-20 flex justify-center px-2">
          <div className="rounded-lg bg-black/85 px-2.5 py-1 text-center shadow-md backdrop-blur-md">
            <p className="line-clamp-2 text-xs font-medium text-white drop-shadow-xs">
              {activeCue.text}
            </p>
          </div>
        </div>
      ) : null}

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
  const singleImgRef = useRef<HTMLImageElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- media.id is stable
  useEffect(() => {
    const el = singleImgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setIsLoading(false);
    }
  }, [media.id]);

  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- media/natural are the intended triggers
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
    img.src = getMediaImageUrl(media, "lg-webp.webp");
    return () => {
      img.removeEventListener("load", handleLoad);
    };
  }, [media, natural, hasStoredDims]);

  const dims = natural;

  if (isFailed) {
    return (
      <div className="bg-muted/20 relative flex max-h-125 w-full items-center justify-center overflow-hidden rounded-xl">
        <Image
          alt="Attachment unavailable"
          className="h-auto max-h-125 w-full object-contain opacity-60"
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
      {/* eslint-disable-next-line @next/next/no-img-element -- srcSet responsive delivery requires a plain img; Next Image does not expose it with unoptimized proxy URLs */}
      <img
        alt="Attachment"
        className={cn(
          "rounded-xl object-contain",
          isPortrait
            ? "h-auto max-h-[72vh] w-auto max-w-full"
            : "h-auto w-full",
          isLoading ? "opacity-0" : "asm-media-reveal"
        )}
        decoding="async"
        height={dims?.h ?? 600}
        loading="lazy"
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        ref={singleImgRef}
        sizes="(max-width: 768px) 100vw, 640px"
        src={getMediaImageUrl(media, "lg-webp.webp")}
        srcSet={getMediaImageSrcSet(media)}
        width={dims?.w ?? 640}
      />
      <AiGeneratedBadge
        className="absolute bottom-2 left-2 z-10"
        media={media}
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
  forceMobile = false,
  interactive = true,
  post,
  initialMediaIndex,
}: MediaPreviewsProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialMediaIndex ?? null
  );
  const [showAll, setShowAll] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)") || forceMobile;

  // The grid wrapper animates its real height (measured, not a layout
  // transform) so expanding/collapsing media grows the card smoothly without
  // stretching the tiles inside. The grid's own height is measured (not the
  // wrapper's scrollHeight) because exiting tiles are popped out of flow and
  // would otherwise keep the scrollHeight pinned to the old expanded size.
  const gridHeightWrapperRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridPixelHeight, setGridPixelHeight] = useState<number | null>(null);

  const measureGridHeight = useCallback(() => {
    const wrapper = gridHeightWrapperRef.current;
    const grid = gridRef.current;
    if (!wrapper || !grid) {
      return;
    }
    // Force a synchronous recalc of the CURRENT wrapper height (the
    // before-change style) so the CSS transition has a start value when the
    // new height lands in the next recalc. React 19 flushes passive effects
    // synchronously after discrete events, and the React Compiler would prune
    // a bare offsetHeight read, so the value is consumed by a guard instead.
    const currentWrapperHeight = wrapper.getBoundingClientRect().height;
    if (currentWrapperHeight <= 0) {
      return;
    }
    // offsetHeight includes the grid's own padding, so no computed-style
    // parsing is needed.
    setGridPixelHeight(grid.offsetHeight);
  }, []);

  useEffect(() => {
    measureGridHeight();
  }, [attachments.length, isMobile, measureGridHeight, showAll]);

  // "Show alt" from the post's more menu reveals uploader descriptions
  // inline under the grid. Nothing renders unless something is described.
  const altRevealed = useAltRevealed(post?.id);
  const describedAttachments = attachments.filter(
    (attachment) => attachment.altText
  );

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

  const initialCount = 3;
  // Post page (autoPlay/detail) should always show all media in bento, no collapse.
  const isDetailBento = autoPlayVideos && attachments.length >= 5;
  // Feed cards with 3-5 attachments show a composed bento (no "Show all"
  // collapse); 6+ keeps the collapsible uniform grid.
  const isFeedBento =
    !isDetailBento && attachments.length >= 3 && attachments.length <= 5;
  const visibleAttachments =
    isDetailBento || showAll ? attachments : attachments.slice(0, initialCount);
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
    return <GridImagePreview isMobile={isMobile} isSmall={isSmall} media={m} />;
  };

  const renderPreview = (m: Media, _index: number, isSmall = false) => {
    switch (m.type) {
      case "IMAGE": {
        return renderImagePreview(m, isSmall);
      }
      case "VIDEO": {
        return (
          <VideoPreview
            autoPlay={autoPlayVideos}
            // Grouped tiles stretch to the uniform cell; a lone video keeps
            // its natural aspect (wrapper goes h-auto for it).
            fill={attachments.length > 1}
            media={m}
          />
        );
      }
      case "AUDIO": {
        return <AudioPreview media={m} />;
      }
      default: {
        return null;
      }
    }
  };

  // Cover-cropped cell content for the feed bento tiles (mirrors the post
  // page bento's inline rendering; the layouts differ but the tiles look the
  // same).
  const renderBentoTileContent = (m: Media, index: number) => {
    if (m.type === "IMAGE") {
      if (m.mimeType === "image/svg+xml") {
        return (
          <object
            className="h-full w-full object-cover"
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
        );
      }
      return <BentoImagePreview media={m} />;
    }
    if (m.type === "VIDEO") {
      return <VideoPreview autoPlay={autoPlayVideos} fill media={m} />;
    }
    if (m.type === "AUDIO") {
      return <AudioPreview fill media={m} />;
    }
    return renderPreview(m, index, true);
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
    // Lone videos keep their natural aspect; in GROUPS every tile matches
    // the image cells so rows stay level (object-cover crops the video).
    let wrapperHeightClass = "aspect-square";
    if (!isSmall && m.type === "VIDEO" && attachments.length === 1) {
      wrapperHeightClass = "h-auto";
    } else if (!isMobile) {
      wrapperHeightClass = "aspect-square sm:h-72";
    }

    if (m.type === "AUDIO") {
      return (
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="relative block w-full overflow-hidden rounded-2xl text-left"
          data-card-interactive
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          key={m.id}
          transition={{
            delay: (index % 3) * 0.04,
            duration: 0.32,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {renderPreview(m, index, isSmall)}
        </motion.div>
      );
    }

    return (
      <motion.button
        animate={{ opacity: 1, scale: 1, y: 0 }}
        aria-label="View attachment"
        className={cn(
          "relative block w-full cursor-pointer overflow-hidden rounded-lg p-0 text-left shadow-xs transition-shadow duration-300 hover:shadow-md",
          wrapperHeightClass
        )}
        data-card-interactive
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        key={m.id}
        onClick={handleSelect}
        transition={{
          delay: (index % 3) * 0.04,
          duration: 0.32,
          ease: [0.16, 1, 0.3, 1],
        }}
        type="button"
        whileHover={{
          transition: {
            damping: 28,
            mass: 0.4,
            stiffness: 420,
            type: "spring",
          },
          y: -2,
        }}
        whileTap={{ scale: 0.98, y: 0 }}
      >
        {renderPreview(m, index, isSmall)}
      </motion.button>
    );
  };

  const renderGridCell = (
    m: Media,
    index: number,
    size: "small" | "large" = "large"
  ) => (
    <motion.div
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="relative overflow-hidden rounded-lg shadow-xs transition-shadow duration-300 hover:shadow-md"
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      key={m.id}
      transition={{
        delay: (index % 3) * 0.04,
        duration: 0.32,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{
        transition: {
          damping: 28,
          mass: 0.4,
          stiffness: 420,
          type: "spring",
        },
        y: -2,
      }}
    >
      {renderPreview(m, index, size === "small")}
    </motion.div>
  );

  const renderShowMoreSection = () => {
    if (isMobile) {
      const MOBILE_PREVIEW_LIMIT = 3;
      const visibleRemaining = remainingAttachments.slice(
        0,
        MOBILE_PREVIEW_LIMIT
      );
      const overflowCount = remainingCount - MOBILE_PREVIEW_LIMIT;
      const hasOverflow = overflowCount > 0;

      return (
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="mt-3 px-0.5 pb-1"
          exit={{ opacity: 0, scale: 0.98, y: 6 }}
          initial={{ opacity: 0, scale: 0.98, y: 6 }}
          key="show-more-mobile"
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="apple-panel relative w-full overflow-hidden rounded-2xl">
            <motion.button
              aria-label="Show all media"
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left"
              onClick={handleShowAll}
              type="button"
              whileHover={{ x: 1 }}
              whileTap={{ scale: 0.98 }}
              transition={{ damping: 25, stiffness: 400, type: "spring" }}
            >
              <span className="text-sm font-semibold">More media</span>
              <motion.span
                animate={{ rotate: 0 }}
                transition={{ duration: 0.2 }}
                whileHover={{ y: 1 }}
              >
                <ChevronDown className="text-muted-foreground h-4 w-4" />
              </motion.span>
            </motion.button>
            <div className="grid grid-cols-3 gap-2 border-t border-black/5 p-2 dark:border-white/10">
              {visibleRemaining.map((m, index) => {
                const isLast = index === visibleRemaining.length - 1;
                const showOverflow = hasOverflow && isLast;

                if (showOverflow) {
                  let thumb: React.ReactNode;
                  if (m.type === "IMAGE" && m.mimeType === "image/svg+xml") {
                    thumb = (
                      // eslint-disable-next-line @next/next/no-img-element -- tiny static thumbnail for overflow preview
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={getMediaUrl(m.id)}
                      />
                    );
                  } else if (m.type === "IMAGE") {
                    thumb = (
                      // eslint-disable-next-line @next/next/no-img-element -- tiny static thumbnail for overflow preview
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={getMediaImageUrl(m, "thumb-webp.webp")}
                      />
                    );
                  } else if (m.type === "VIDEO") {
                    thumb = (
                      // eslint-disable-next-line @next/next/no-img-element -- video poster for overflow preview
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={getMediaProxyUrl(m)}
                      />
                    );
                  } else {
                    thumb = (
                      <div className="bg-primary/5 flex h-full w-full items-center justify-center">
                        <FileAudioIcon className="text-primary h-7 w-7" />
                      </div>
                    );
                  }

                  return (
                    <div
                      className="relative aspect-square overflow-hidden rounded-lg shadow-xs"
                      key={m.id}
                    >
                      <div className="absolute inset-0">{thumb}</div>
                      <button
                        aria-label={`Show ${overflowCount} more media`}
                        className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 bg-black/55 backdrop-blur-[2px] transition-colors hover:bg-black/60 active:bg-black/70"
                        onClick={handleShowAll}
                        type="button"
                      >
                        <span className="text-base leading-none font-semibold text-white tabular-nums">
                          +{overflowCount}
                        </span>
                        <span className="text-xs leading-none font-medium text-white/85">
                          more
                        </span>
                      </button>
                    </div>
                  );
                }

                return interactive
                  ? renderGridTile(m, index + initialCount, "small")
                  : renderGridCell(m, index + initialCount, "small");
              })}
            </div>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="mt-3 px-0.5 pb-1"
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        initial={{ opacity: 0, scale: 0.98, y: 6 }}
        key="show-more-desktop"
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.button
          aria-label="Show all media"
          className="apple-panel relative flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl p-2 text-left"
          onClick={handleShowAll}
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98, y: 0 }}
          transition={{ damping: 25, stiffness: 400, type: "spring" }}
        >
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pl-2">
            {/* Every remaining attachment previews right in the bar - it is
                wide enough, and horizontal scroll absorbs extremes. */}
            {remainingAttachments.map((m, index) =>
              m.type === "IMAGE" ? (
                <div
                  className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl shadow-xs"
                  key={m.id}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny static thumbnail; Next Image adds nothing over the sized thumb variant */}
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    decoding="async"
                    loading="lazy"
                    src={
                      m.mimeType === "image/svg+xml"
                        ? getMediaUrl(m.id)
                        : getMediaImageUrl(m, "thumb-webp.webp")
                    }
                  />
                </div>
              ) : (
                <div
                  className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl shadow-xs"
                  key={m.id}
                >
                  {renderPreview(m, index + initialCount)}
                  <div className="absolute inset-0 bg-black/10" />
                </div>
              )
            )}
          </div>
          <span className="flex items-center gap-1.5 pr-3 text-sm font-semibold">
            Show all
            <motion.span
              animate={{ rotate: 0 }}
              transition={{ duration: 0.2 }}
              whileHover={{ y: 1 }}
            >
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            </motion.span>
          </span>
        </motion.button>
      </motion.div>
    );
  };

  // Bento for post-page: detail with 5+ items always shows bento, no collapse.
  const isBento = isDetailBento;

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
      {!isFeedBento && !isBento && isMobile && first ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 w-full"
          initial={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {renderFirstAttachment()}
        </motion.div>
      ) : null}

      {isFeedBento ? (
        <motion.div
          className={cn(
            "grid gap-2",
            "auto-rows-[130px]",
            !isMobile && "sm:auto-rows-[180px]",
            FEED_BENTO_LAYOUTS[attachments.length].cols
          )}
        >
          {attachments.map((m, index) => (
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={cn(
                "group relative overflow-hidden rounded-lg shadow-xs transition-shadow duration-300 hover:shadow-md",
                FEED_BENTO_LAYOUTS[attachments.length].spans[index]
              )}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              key={m.id}
              onClick={interactive ? () => openAtIndex(index) : undefined}
              onKeyDown={
                interactive
                  ? (event: React.KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openAtIndex(index);
                      }
                    }
                  : undefined
              }
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              transition={{
                delay: (index % 3) * 0.04,
                duration: 0.32,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <div className="absolute inset-0 h-full w-full">
                {renderBentoTileContent(m, index)}
              </div>
              <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
              <AiGeneratedBadge
                className="absolute bottom-2 left-2 z-10"
                media={m}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : null}
      {!isFeedBento && isBento ? (
        <motion.div
          className={cn(
            "grid gap-2",
            isMobile
              ? "auto-rows-[140px] grid-cols-2"
              : "auto-rows-[180px] grid-cols-3"
          )}
          layout
          transition={{ damping: 30, stiffness: 300, type: "spring" }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {visibleAttachments.map((m, index) => {
              const isFirst = index === 0;
              return (
                <motion.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className={cn(
                    "group relative overflow-hidden rounded-lg shadow-xs transition-shadow duration-300 hover:shadow-md",
                    isFirst ? "col-span-2 row-span-2" : ""
                  )}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  key={m.id}
                  onClick={interactive ? () => openAtIndex(index) : undefined}
                  onKeyDown={
                    interactive
                      ? (event: React.KeyboardEvent<HTMLDivElement>) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openAtIndex(index);
                          }
                        }
                      : undefined
                  }
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  transition={{
                    delay: index * 0.04,
                    duration: 0.32,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  whileHover={{
                    transition: {
                      damping: 28,
                      mass: 0.4,
                      stiffness: 420,
                      type: "spring",
                    },
                    y: -2,
                  }}
                >
                  <div className="absolute inset-0 h-full w-full">
                    {(() => {
                      if (m.type === "IMAGE") {
                        if (m.mimeType === "image/svg+xml") {
                          return (
                            <object
                              className="h-full w-full object-cover"
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
                          );
                        }
                        return <BentoImagePreview media={m} />;
                      }
                      if (m.type === "VIDEO") {
                        return (
                          <VideoPreview
                            autoPlay={autoPlayVideos}
                            fill
                            media={m}
                          />
                        );
                      }
                      return renderPreview(m, index, true);
                    })()}
                  </div>
                  <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
                  <AiGeneratedBadge
                    className="absolute bottom-2 left-2 z-10"
                    media={m}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      ) : null}
      {!isFeedBento && !isBento ? (
        // The wrapper's height is a real CSS transition (measured px values,
        // never a layout transform or "auto" interpolation), so the card
        // grows and collapses smoothly without stretching the tiles. Only
        // grids that can actually collapse (4+ attachments) get the measured
        // height: single images size by natural ratio after load and would
        // leave the measured height stale below them.
        <div
          className={
            attachments.length > initialCount ? "overflow-hidden" : undefined
          }
          ref={gridHeightWrapperRef}
          style={
            attachments.length > initialCount && gridPixelHeight !== null
              ? {
                  height: `${gridPixelHeight}px`,
                  transition: "height 480ms cubic-bezier(0.16, 1, 0.3, 1)",
                }
              : undefined
          }
        >
          <div
            className={cn(
              "grid gap-4 pt-1 pb-2",
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
            ref={gridRef}
          >
            <AnimatePresence initial={false} mode="popLayout">
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
            </AnimatePresence>
          </div>
        </div>
      ) : null}

      <AnimatePresence initial={false} mode="popLayout">
        {!isFeedBento &&
        !isBento &&
        !showAll &&
        attachments.length > initialCount
          ? renderShowMoreSection()
          : null}
      </AnimatePresence>

      <AnimatePresence initial={false} mode="popLayout">
        {!isFeedBento && !isBento && showAll ? (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mt-3 px-0.5 pb-1"
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            key="show-less"
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.button
              aria-label="Show fewer media"
              className="apple-panel flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl px-4 py-3 text-sm font-semibold"
              onClick={handleShowLess}
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98, y: 0 }}
              transition={{ damping: 25, stiffness: 400, type: "spring" }}
            >
              Show less
              <motion.span whileHover={{ y: -1 }}>
                <ChevronUp className="text-muted-foreground h-4 w-4" />
              </motion.span>
            </motion.button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Inline alt text strip, toggled by "Show alt" in the more menu - one
          caption row per described attachment, in attachment order. */}
      {altRevealed && describedAttachments.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {describedAttachments.map((media) => (
            <div
              className="apple-panel flex items-start rounded-lg px-3 py-2"
              key={media.id}
            >
              <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-snug break-words">
                {media.altText}
              </p>
            </div>
          ))}
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
