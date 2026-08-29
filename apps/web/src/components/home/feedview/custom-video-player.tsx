"use client";
import { Slider } from "@asm/ui/shadui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import zephImage from "@assets/zeph.png";
import type Hls from "hls.js";
import {
  FastForward,
  Maximize,
  MinimizeIcon,
  Pause,
  Play,
  Rewind,
  Settings,
  Subtitles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseWebVttCues,
  VideoTranscriptDrawer,
} from "@/components/media/video-transcript-drawer";
import type { TranscriptCue } from "@/components/media/video-transcript-drawer";
import { cn } from "@/lib/utils";
import { useVideoMuteStore } from "@/lib/video-mute-store";

interface CustomVideoPlayerProps {
  autoPlay?: boolean;
  captions?: { src: string; label: string; srclang: string }[];
  className?: string;
  /** Keeps keyboard shortcuts and the double-click skip zones working even
   * when hideControls suppresses the on-video overlay UI (desktop media page,
   * where the bottom panel drives playback). */
  desktopGestures?: boolean;
  /** Suppresses the built-in control overlays; playback is driven externally
   * (media page bottom panel) via videoRef + onExternalState. */
  hideControls?: boolean;
  hlsSrc?: string;
  mediaId?: string;
  onError: () => void;
  onExternalState?: (state: {
    currentTime: number;
    duration: number;
    isMuted: boolean;
    isPlaying: boolean;
    playbackRate: number;
    volume: number;
  }) => void;
  onLoadedData: () => void;
  onPlaying?: () => void;
  onProgress?: () => void;
  poster?: string;
  rawTranscript?: string | null;
  src: string;
  /** Receives the inner video element so external controls can drive it. */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export interface VideoPlaybackState {
  currentTime: number;
  duration: number;
  isMuted: boolean;
  isPlaying: boolean;
  playbackRate: number;
  volume: number;
}

type KeyboardControls = Record<string, () => void>;

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const EMPTY_CAPTIONS: { src: string; label: string; srclang: string }[] = [];

async function getHlsConstructor(): Promise<typeof Hls | null> {
  try {
    const mod = await import("hls.js");
    return mod.default;
  } catch {
    return null;
  }
}

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const ORANGE_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

const GLASS_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2),inset_0_1px_2px_rgba(255,255,255,0.3),0_0_0_1px_rgba(0,0,0,0.45),0_2px_4px_rgba(0,0,0,0.25)]";

// The video element fills its container (h-full w-full) and object-contain
// shrinks the actual picture inside it, so the element's box cannot tell a
// tap on the video apart from a tap on the letterbox bars: the picture's
// rect can. Returns whether a click point falls on the visible content.
export function isClickInVideoContent(
  clientX: number,
  clientY: number,
  video: HTMLVideoElement
): boolean {
  const rect = video.getBoundingClientRect();
  const naturalWidth = video.videoWidth;
  const naturalHeight = video.videoHeight;
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    // Metadata not loaded yet: treat the whole element as content.
    return true;
  }
  const scale = Math.min(
    rect.width / naturalWidth,
    rect.height / naturalHeight
  );
  const contentWidth = naturalWidth * scale;
  const contentHeight = naturalHeight * scale;
  const contentLeft = rect.left + (rect.width - contentWidth) / 2;
  const contentTop = rect.top + (rect.height - contentHeight) / 2;
  return (
    clientX >= contentLeft &&
    clientX <= contentLeft + contentWidth &&
    clientY >= contentTop &&
    clientY <= contentTop + contentHeight
  );
}

const GlassIconButton: React.FC<{
  "aria-label": string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
}> = ({
  "aria-label": ariaLabel,
  children,
  className,
  onClick,
  onMouseEnter,
}) => (
  <button
    aria-label={ariaLabel}
    className={cn(
      "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-all duration-200 hover:bg-white/20 hover:brightness-110 active:translate-y-px",
      GLASS_BTN_SHADOW,
      className
    )}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    type="button"
  >
    {children}
  </button>
);

export const CustomVideoPlayer = ({
  autoPlay = false,
  hlsSrc,
  src,
  onLoadedData,
  onError,
  onPlaying,
  onProgress,
  onExternalState,
  className,
  captions = EMPTY_CAPTIONS,
  desktopGestures = false,
  hideControls = false,
  mediaId,
  poster,
  rawTranscript,
  videoRef: externalVideoRef,
}: CustomVideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [cues, setCues] = useState<TranscriptCue[]>([]);

  const captionUrl =
    captions[0]?.src || (mediaId ? `/api/media/${mediaId}?captions=1` : null);

  useEffect(() => {
    if (!captionUrl) {
      // oxlint-disable-next-line react/set-state-in-effect
      setCues([]);
      return;
    }
    let cancelled = false;
    async function loadCues() {
      try {
        const res = await fetch(captionUrl as string);
        if (res.ok) {
          const vtt = await res.text();
          if (!cancelled && vtt) {
            setCues(parseWebVttCues(vtt));
          }
        }
      } catch {
        // Ignore fetch errors
      }
    }
    void loadCues();
    return () => {
      cancelled = true;
    };
  }, [captionUrl]);

  // Keep native browser track hidden so unstyled cues don't collide with controls
  useEffect(() => {
    const video = videoRef.current;
    if (video?.textTracks) {
      for (const track of video.textTracks) {
        if (track) {
          track.mode = "hidden";
        }
      }
    }
  });

  const activeCue = useMemo(() => {
    if (!captionsEnabled || cues.length === 0) {
      return null;
    }
    return (
      cues.find((c) => currentTime >= c.start && currentTime <= c.end) ?? null
    );
  }, [captionsEnabled, cues, currentTime]);

  const toggleCaptions = useCallback(() => {
    setCaptionsEnabled((prev) => !prev);
  }, []);

  const toggleTranscript = useCallback(() => {
    setShowTranscript((prev) => !prev);
  }, []);

  const hlsInstanceRef = useRef<InstanceType<typeof Hls> | null>(null);

  useEffect(
    () => () => {
      hlsInstanceRef.current?.destroy();
      hlsInstanceRef.current = null;
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.src = "";
          video.load();
        } catch {
          // Ignore
        }
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    },
    []
  );

  // Prefer an adaptive HLS stream when the pipeline generated one.
  // Safari plays HLS natively; everywhere else a 40 kB hls.js bundle
  // covers it without touching the progressive MP4 fallback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsSrc) {
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      if (video.src !== hlsSrc) {
        video.src = hlsSrc;
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      const HlsCtor = await getHlsConstructor();
      if (cancelled || !video || !HlsCtor || !HlsCtor.isSupported()) {
        return;
      }
      hlsInstanceRef.current?.destroy();
      // Gust tiles are ~320px; cap initial level by player size and by
      // effective connection so a 4G phone on a 320 tile doesn't start at
      // 1080p before throughput samples arrive.
      const { connection } = navigator as unknown as {
        connection?: { effectiveType?: string };
      };
      const effectiveType = connection?.effectiveType;
      const connectionCap: Record<string, number> = {
        "2g": 0,
        "3g": 1,
        "4g": 3,
        "slow-2g": 0,
      };
      const maxAutoLevel =
        effectiveType !== undefined && effectiveType in connectionCap
          ? connectionCap[effectiveType]
          : undefined;
      const hls = new HlsCtor({
        capLevelToPlayerSize: true,
        enableWorker: true,
        ...(maxAutoLevel === undefined
          ? {}
          : { capLevelToPlayerSize: true, startLevel: maxAutoLevel }),
      } as unknown as ConstructorParameters<typeof HlsCtor>[0]);
      // capLevelToPlayerSize already keeps 320px tiles off 1080p; startLevel
      // gives slow connections a head start at 360/480p so first frame arrives
      // even before AbrController measures throughput.
      void maxAutoLevel;
      // HLS failed → fall back to progressive MP4 so the video still plays
      // on thin network or transient segment error, instead of stuck spinner.
      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          const fallback = video.dataset.fallbackSrc;
          if (fallback) {
            hls.destroy();
            hlsInstanceRef.current = null;
            video.src = fallback;
            void (async () => {
              try {
                await video.play();
              } catch {
                // Autoplay may be blocked; the poster frame is already up.
              }
            })();
          }
        }
      });
      hlsInstanceRef.current = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      hlsInstanceRef.current?.destroy();
      hlsInstanceRef.current = null;
    };
  }, [hlsSrc]);

  // Autoplay when the viewer opens (e.g. from the post detail page). Browsers
  // block unmuted autoplay until the user interacts, so start muted (unless
  // the session preference unmuted it) and mirror that in the UI. Only report
  // playing once play() actually resolves so the play/pause state stays in
  // sync with the real playback.
  useEffect(() => {
    if (!autoPlay) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = useVideoMuteStore.getState().isMuted;
    setIsMuted(video.muted);
    const attemptPlay = async () => {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    };

    void attemptPlay();
  }, [autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const handleTimeUpdate = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      setCurrentTime(video.currentTime);
      // durationchange can fire before React attaches (or never re-fire once the
      // metadata is cached), so also reconcile the real duration on every
      // timeupdate. Guarded so a stale 0 / Infinity never overwrites a good one.
      const realDuration = video.duration;
      if (Number.isFinite(realDuration) && realDuration > 0) {
        setDuration((prev) => (prev === realDuration ? prev : realDuration));
      }
      // Let the parent know bytes are still flowing, so a load deadline can be
      // extended while playback makes progress.
      onProgress?.();
    },
    [onProgress]
  );

  const handleDurationChange = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const next = event.currentTarget.duration;
      if (Number.isFinite(next) && next > 0) {
        setDuration(next);
      }
    },
    []
  );

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (isPlaying) {
        video.pause();
      } else {
        void (async () => {
          try {
            await video.play();
          } catch {
            setIsPlaying(false);
          }
        })();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  // Only the visible picture toggles playback; a tap on the letterbox bars
  // (the element's box is larger than the content) does nothing here and
  // bubbles up so the media page can toggle its UI instead.
  const handleVideoSurfaceClick = useCallback(
    (event: ReactMouseEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (!isClickInVideoContent(event.clientX, event.clientY, video)) {
        return;
      }
      handlePlayPause();
    },
    [handlePlayPause]
  );

  const skip = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
    }
  }, []);

  const handleVolumeChange = useCallback((value: number[]) => {
    const [newVolume] = value;
    if (videoRef.current) {
      if (videoRef.current && newVolume !== undefined) {
        videoRef.current.volume = newVolume;
        // Unmute as soon as the user raises the volume above zero so the video
        // element's muted flag stays in sync with the slider.
        videoRef.current.muted = newVolume === 0;
      }
      if (newVolume !== undefined) {
        setVolume(newVolume);
      }
      setIsMuted(newVolume === 0);
    }
  }, []);

  const handleVolumeUp = useCallback(() => {
    const newVolume = Math.min(1, volume + 0.1);
    handleVolumeChange([newVolume]);
  }, [volume, handleVolumeChange]);

  const handleVolumeDown = useCallback(() => {
    const newVolume = Math.max(0, volume - 0.1);
    handleVolumeChange([newVolume]);
  }, [volume, handleVolumeChange]);

  const skipLeft = useCallback(() => skip(-10), [skip]);
  const skipRight = useCallback(() => skip(10), [skip]);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const newMuted = !isMuted;
      videoRef.current.muted = newMuted;
      setIsMuted(newMuted);
      videoRef.current.volume = newMuted ? 0 : 1;
      setVolume(newMuted ? 0 : 1);
    }
  }, [isMuted]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) {
      return;
    }

    await (document.fullscreenElement
      ? document.exitFullscreen()
      : containerRef.current.requestFullscreen());
  }, []);

  // Report playback state outward so external controls (mobile media page
  // bottom panel) can mirror and drive the video.
  useEffect(() => {
    onExternalState?.({
      currentTime,
      duration,
      isMuted,
      isPlaying,
      playbackRate: playbackSpeed,
      volume,
    });
  }, [
    currentTime,
    duration,
    isMuted,
    isPlaying,
    onExternalState,
    playbackSpeed,
    volume,
  ]);

  useEffect(() => {
    if (hideControls && !desktopGestures) {
      return;
    }
    const keyboardControls: KeyboardControls = {
      " ": handlePlayPause,
      ArrowDown: handleVolumeDown,
      ArrowLeft: skipLeft,
      ArrowRight: skipRight,
      ArrowUp: handleVolumeUp,
      C: toggleCaptions,
      T: toggleTranscript,
      c: toggleCaptions,
      f: toggleFullscreen,
      k: handlePlayPause,
      m: toggleMute,
      t: toggleTranscript,
    };

    const handleKeyPress = (e: KeyboardEvent) => {
      if (
        !showControls ||
        (e.target as HTMLElement)?.tagName === "INPUT" ||
        (e.target as HTMLElement)?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (keyboardControls[e.key]) {
        e.preventDefault();
        if (keyboardControls[e.key]) {
          keyboardControls[e.key]?.();
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    hideControls,
    desktopGestures,
    showControls,
    handlePlayPause,
    toggleFullscreen,
    toggleMute,
    handleVolumeUp,
    handleVolumeDown,
    skipLeft,
    skipRight,
    toggleCaptions,
    toggleTranscript,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);

    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);

    return () => {
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
    };
  }, []);

  // External controls (mobile media page bottom panel) drive the video
  // element directly; mirror muted/volume and rate back into state via the
  // native events so React's controlled props never clobber them on the next
  // render.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const handleNativeVolumeChange = () => {
      setIsMuted(video.muted);
      setVolume(video.volume);
      // Every mute path (panel toggle, built-in button, keyboard, volume
      // slider) lands here via the native event, so the shared preference
      // stays in sync no matter which surface changed it.
      useVideoMuteStore.getState().setMuted(video.muted);
    };
    const handleNativeRateChange = () => {
      setPlaybackSpeed(video.playbackRate);
    };
    video.addEventListener("volumechange", handleNativeVolumeChange);
    video.addEventListener("ratechange", handleNativeRateChange);
    return () => {
      video.removeEventListener("volumechange", handleNativeVolumeChange);
      video.removeEventListener("ratechange", handleNativeRateChange);
    };
  }, []);

  const handleProgressChange = useCallback((value: number[]) => {
    if (videoRef.current) {
      const [newTime] = value;
      if (newTime !== undefined) {
        videoRef.current.currentTime = newTime;
      }
      if (newTime !== undefined) {
        setCurrentTime(newTime);
      }
    }
  }, []);

  const handlePlaybackSpeedChange = useCallback((speed: string) => {
    const newSpeed = Number(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = newSpeed;
      setPlaybackSpeed(newSpeed);
    }
  }, []);

  const handleMouseMove = useCallback(() => {
    if (hideControls) {
      return;
    }
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2000);
  }, [hideControls, isPlaying]);

  const handleMouseLeave = useCallback(() => {
    if (hideControls) {
      return;
    }
    if (isPlaying) {
      setShowControls(false);
    }
  }, [hideControls, isPlaying]);

  const handleSkipBack = useCallback(() => skip(-10), [skip]);
  const handleSkipForward = useCallback(() => skip(10), [skip]);

  const handleToggleSpeedMenu = useCallback(() => {
    setShowSpeedMenu((current) => !current);
  }, []);

  const handleSpeedSelect = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const { speed } = event.currentTarget.dataset;
      if (speed) {
        handlePlaybackSpeedChange(speed);
      }
    },
    [handlePlaybackSpeedChange]
  );

  const handleControlsMouseEnter = useCallback(() => {
    setShowControls(true);
  }, []);

  const handleVolumeSliderMouseEnter = useCallback(() => {
    setShowVolumeSlider(true);
  }, []);

  const handleVolumeSliderMouseLeave = useCallback(() => {
    setShowVolumeSlider(false);
  }, []);

  const handleCloseHotkeys = useCallback(() => {
    setShowHotkeys(false);
  }, []);

  let captionBottomClass = "bottom-8 sm:bottom-10";
  if (hideControls) {
    // In modal / MediaViewer on mobile, elevate above the action bar and player chips
    captionBottomClass = "bottom-52 sm:bottom-56 lg:bottom-24";
  } else if (showControls) {
    captionBottomClass = "bottom-36 sm:bottom-40";
  }

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-lg",
        isFullscreen && "h-screen",
        className
      )}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      ref={containerRef}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions are optional and passed via the captions prop when available */}
      <video
        className="h-full w-full object-contain outline-hidden select-none focus:outline-hidden focus-visible:outline-none"
        data-fallback-src={src}
        loop
        muted={isMuted}
        onClick={handleVideoSurfaceClick}
        onDurationChange={handleDurationChange}
        onError={onError}
        onLoadedData={onLoadedData}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPlaying={onPlaying}
        onTimeUpdate={handleTimeUpdate}
        playsInline
        poster={poster}
        preload="metadata"
        ref={(element) => {
          videoRef.current = element;
          if (externalVideoRef) {
            externalVideoRef.current = element;
          }
        }}
        src={src}
      >
        {captions.map((caption) => (
          <track
            default={false}
            key={caption.src}
            kind="subtitles"
            label={caption.label}
            src={caption.src}
            srcLang={caption.srclang}
          />
        ))}
      </video>

      {/* The double-click skip zones only belong with the built-in control
          bar: with it hidden, single clicks on the video must reach the
          play/pause handler (and letterbox taps must reach the media page's
          UI toggle), so the zones are dropped entirely. */}
      {hideControls || showTranscript ? null : (
        <div className="absolute inset-0 z-30 flex select-none">
          <button
            aria-label="Double click to rewind 10 seconds"
            className="h-full w-1/2 cursor-default"
            onDoubleClick={handleSkipBack}
            type="button"
          />
          <button
            aria-label="Double click to forward 10 seconds"
            className="h-full w-1/2 cursor-default"
            onDoubleClick={handleSkipForward}
            type="button"
          />
        </div>
      )}

      {/* Floating captions banner with dynamic placement above controls */}
      <AnimatePresence>
        {captionsEnabled && activeCue ? (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className={cn(
              "pointer-events-none absolute left-1/2 z-35 max-w-[85%] -translate-x-1/2 text-center transition-all duration-200 ease-out",
              captionBottomClass
            )}
            exit={{ opacity: 0, scale: 0.96, y: 2 }}
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            key={`${activeCue.start}-${activeCue.text}`}
            transition={{ duration: 0.12 }}
          >
            <span className="inline-block rounded-lg border border-white/15 bg-black/85 px-3.5 py-1.5 text-xs leading-snug font-semibold tracking-wide text-white shadow-2xl backdrop-blur-md select-none sm:text-sm md:text-base">
              {activeCue.text}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isBuffering ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <div className="rounded-full bg-black/50 p-4 backdrop-blur-sm">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!hideControls && showControls ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-40 flex flex-col justify-between bg-linear-to-t from-black/60 to-black/0"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center justify-end gap-3 p-5">
              <div className="relative">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <GlassIconButton
                        aria-label="Playback settings"
                        onClick={handleToggleSpeedMenu}
                      >
                        <Settings className="h-5 w-5 text-white" />
                      </GlassIconButton>
                    </TooltipTrigger>
                    <TooltipContent
                      className="bg-black/80 backdrop-blur-md"
                      side="bottom"
                    >
                      <p className="text-xs">Playback Settings</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <AnimatePresence>
                  {showSpeedMenu ? (
                    <motion.div
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="absolute top-full right-0 mt-2 origin-top-right"
                      exit={{ opacity: 0, scale: 0.95, y: -5 }}
                      initial={{ opacity: 0, scale: 0.95, y: -5 }}
                      transition={{ duration: 0.15 }}
                    >
                      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/80 shadow-lg backdrop-blur-md">
                        <div className="p-2">
                          <p className="mb-2 px-2 text-xs font-medium text-white/60">
                            Playback Speed
                          </p>
                          <div className="space-y-0.5">
                            {PLAYBACK_SPEEDS.map((speed) => (
                              <button
                                className={cn(
                                  "w-full rounded-md px-3 py-1.5 text-left text-xs transition-all",
                                  playbackSpeed === speed
                                    ? "bg-white/20 text-white"
                                    : "text-white/70 hover:bg-white/10 hover:text-white"
                                )}
                                data-speed={speed.toString()}
                                key={speed}
                                onClick={handleSpeedSelect}
                                type="button"
                              >
                                <div className="flex items-center justify-between">
                                  <span>{speed}x</span>
                                  {playbackSpeed === speed ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                  ) : null}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              {captions && captions.length > 0 ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <GlassIconButton
                        aria-label={
                          captionsEnabled
                            ? "Disable captions (C)"
                            : "Enable captions (C)"
                        }
                        className={cn(
                          captionsEnabled &&
                            "border-orange-500/60 bg-white/20 text-orange-400"
                        )}
                        onClick={toggleCaptions}
                      >
                        <Subtitles
                          className={cn(
                            "h-5 w-5",
                            captionsEnabled ? "text-orange-400" : "text-white"
                          )}
                        />
                      </GlassIconButton>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>
                        {captionsEnabled
                          ? "Captions On (C)"
                          : "Captions Off (C)"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}

              {mediaId ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <GlassIconButton
                        aria-label="Transcript (T)"
                        className={cn(
                          "xl:hidden",
                          showTranscript &&
                            "border-orange-500/60 bg-white/20 text-orange-400"
                        )}
                        onClick={toggleTranscript}
                      >
                        <Image
                          alt="Transcript"
                          className="size-5 object-contain"
                          src={zephImage}
                        />
                      </GlassIconButton>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>Transcript (T)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <GlassIconButton
                      aria-label={
                        isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                      }
                      onClick={toggleFullscreen}
                    >
                      {isFullscreen ? (
                        <MinimizeIcon className="h-5 w-5 text-white" />
                      ) : (
                        <Maximize className="h-5 w-5 text-white" />
                      )}
                    </GlassIconButton>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="space-y-3 p-5">
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keeps the control bar visible while interacting with the seek slider */}
              <section
                aria-label="Video progress controls"
                className="group relative"
                onMouseEnter={handleControlsMouseEnter}
              >
                <Slider
                  className="h-1.5 transition-all group-hover:h-2 *:[[role=slider]]:border-orange-400/70 [&>span:first-child]:bg-white/20 [&>span:first-child>span]:bg-linear-to-r [&>span:first-child>span]:from-[#ff9500] [&>span:first-child>span]:to-[#e65500]"
                  max={duration}
                  min={0}
                  onValueChange={handleProgressChange}
                  step={0.1}
                  value={[currentTime]}
                />
                <div className="mt-1.5 flex justify-between text-sm text-white/80">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </section>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <GlassIconButton
                          aria-label="Rewind 10 seconds"
                          onClick={handleSkipBack}
                        >
                          <Rewind className="h-6 w-6 text-white" />
                        </GlassIconButton>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Rewind 10s (←)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          aria-label={isPlaying ? "Pause" : "Play"}
                          className={cn(
                            "flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white transition-all duration-200 hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px",
                            ORANGE_BTN_SHADOW
                          )}
                          onClick={handlePlayPause}
                          type="button"
                        >
                          {isPlaying ? (
                            <Pause className="h-7 w-7" />
                          ) : (
                            <Play className="ml-0.5 h-7 w-7" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Play/Pause (Space)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <GlassIconButton
                          aria-label="Forward 10 seconds"
                          onClick={handleSkipForward}
                        >
                          <FastForward className="h-6 w-6 text-white" />
                        </GlassIconButton>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Forward 10s (→)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="relative flex items-center gap-3">
                  <div className="relative flex items-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <GlassIconButton
                            aria-label={isMuted ? "Unmute" : "Mute"}
                            onClick={toggleMute}
                            onMouseEnter={handleVolumeSliderMouseEnter}
                          >
                            {isMuted || volume === 0 ? (
                              <VolumeX className="h-6 w-6 text-white" />
                            ) : (
                              <Volume2 className="h-6 w-6 text-white" />
                            )}
                          </GlassIconButton>
                        </TooltipTrigger>
                        <TooltipContent
                          className="bg-black/80 backdrop-blur-md"
                          side="top"
                        >
                          <p className="text-xs">Mute (M)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <AnimatePresence>
                      {showVolumeSlider ? (
                        <motion.div
                          animate={{ opacity: 1, width: "160px" }}
                          className="ml-3 overflow-hidden"
                          exit={{ opacity: 0, width: 0 }}
                          initial={{ opacity: 0, width: 0 }}
                          onMouseLeave={handleVolumeSliderMouseLeave}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="flex items-center gap-3 rounded-full bg-black/40 px-4 py-2.5 backdrop-blur-md">
                            <Slider
                              className="relative flex h-5 w-full touch-none items-center select-none *:[[role=slider]]:border-orange-400/70 [&>span:first-child]:bg-white/20 [&>span:first-child>span]:bg-linear-to-r [&>span:first-child>span]:from-[#ff9500] [&>span:first-child>span]:to-[#e65500]"
                              max={1}
                              min={0}
                              onValueChange={handleVolumeChange}
                              step={0.01}
                              value={[volume]}
                            />
                            <span className="min-w-8 text-right text-xs font-medium text-white/90">
                              {Math.round(volume * 100)}%
                            </span>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showHotkeys ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={handleCloseHotkeys}
          >
            <div className="grid max-w-md gap-8 rounded-lg bg-black/90 p-6 text-white backdrop-blur-xs sm:grid-cols-2">
              <div>
                <h3 className="mb-2 font-semibold">Keyboard Shortcuts</h3>
                <ul className="space-y-1 text-sm text-white/80">
                  <li>Space - Play/Pause</li>
                  <li>← → - Seek 10s</li>
                  <li>↑ ↓ - Volume</li>
                  <li>M - Mute</li>
                  <li>C - Captions</li>
                  <li>T - Transcript</li>
                  <li>F - Fullscreen</li>
                </ul>
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Mouse Controls</h3>
                <ul className="space-y-1 text-sm text-white/80">
                  <li>Double Click - Seek 10s</li>
                  <li>Hover Volume - Adjust</li>
                  <li>Click Settings - Speed</li>
                </ul>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {mediaId ? (
        <VideoTranscriptDrawer
          currentTime={currentTime}
          isOpen={showTranscript}
          mediaId={mediaId}
          onClose={() => setShowTranscript(false)}
          onSeek={(seconds) => {
            if (videoRef.current) {
              videoRef.current.currentTime = seconds;
              void videoRef.current.play();
            }
          }}
          rawTranscript={rawTranscript}
        />
      ) : null}
    </div>
  );
};
