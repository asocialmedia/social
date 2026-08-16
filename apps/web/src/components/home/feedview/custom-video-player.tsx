"use client";
import { Slider } from "@asm/ui/shadui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import {
  FastForward,
  Maximize,
  MinimizeIcon,
  Pause,
  Play,
  Rewind,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface CustomVideoPlayerProps {
  autoPlay?: boolean;
  captions?: { src: string; label: string; srclang: string }[];
  className?: string;
  onError: () => void;
  onLoadedData: () => void;
  poster?: string;
  src: string;
}

type KeyboardControls = Record<string, () => void>;

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const EMPTY_CAPTIONS: { src: string; label: string; srclang: string }[] = [];

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const ORANGE_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

const GLASS_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2),inset_0_1px_2px_rgba(255,255,255,0.3),0_0_0_1px_rgba(0,0,0,0.45),0_2px_4px_rgba(0,0,0,0.25)]";

const GlassIconButton: React.FC<{
  "aria-label": string;
  children: React.ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
}> = ({ "aria-label": ariaLabel, children, onClick, onMouseEnter }) => (
  <button
    aria-label={ariaLabel}
    className={cn(
      "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-all duration-200 hover:bg-white/20 hover:brightness-110 active:translate-y-px",
      GLASS_BTN_SHADOW
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
  src,
  onLoadedData,
  onError,
  className,
  captions = EMPTY_CAPTIONS,
  poster,
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

  useEffect(
    () => () => {
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

  // Autoplay when the viewer opens (e.g. from the post detail page). Browsers
  // block unmuted autoplay until the user interacts, so start muted and mirror
  // that in the UI. Only report playing once play() actually resolves so the
  // play/pause state stays in sync with the real playback.
  useEffect(() => {
    if (!autoPlay) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = true;
    setIsMuted(true);
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

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

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

  useEffect(() => {
    const keyboardControls: KeyboardControls = {
      " ": handlePlayPause,
      ArrowDown: handleVolumeDown,
      ArrowLeft: skipLeft,
      ArrowRight: skipRight,
      ArrowUp: handleVolumeUp,
      f: toggleFullscreen,
      k: handlePlayPause,
      m: toggleMute,
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
    showControls,
    handlePlayPause,
    toggleFullscreen,
    toggleMute,
    handleVolumeUp,
    handleVolumeDown,
    skipLeft,
    skipRight,
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
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2000);
  }, [isPlaying]);

  const handleMouseLeave = useCallback(() => {
    if (isPlaying) {
      setShowControls(false);
    }
  }, [isPlaying]);

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
        className="h-full w-full outline-hidden select-none focus:outline-hidden focus-visible:outline-none"
        loop
        muted={isMuted}
        onClick={handlePlayPause}
        onError={onError}
        onLoadedData={onLoadedData}
        playsInline
        poster={poster}
        preload="metadata"
        ref={videoRef}
        src={src}
      >
        {captions.map((caption, index) => (
          <track
            default={index === 0}
            key={caption.src}
            kind="captions"
            label={caption.label}
            src={caption.src}
            srcLang={caption.srclang}
          />
        ))}
      </video>

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
        {showControls ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-40 flex flex-col justify-between bg-gradient-to-t from-black/60 to-black/0"
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
                  className="h-1.5 transition-all group-hover:h-2 [&>[role=slider]]:border-orange-400/70 [&>span:first-child]:bg-white/20 [&>span:first-child>span]:bg-linear-to-r [&>span:first-child>span]:from-[#ff9500] [&>span:first-child>span]:to-[#e65500]"
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
                              className="relative flex h-5 w-full touch-none items-center select-none [&>[role=slider]]:border-orange-400/70 [&>span:first-child]:bg-white/20 [&>span:first-child>span]:bg-linear-to-r [&>span:first-child>span]:from-[#ff9500] [&>span:first-child>span]:to-[#e65500]"
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
    </div>
  );
};
