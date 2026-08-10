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
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface CustomVideoPlayerProps {
  captions?: { src: string; label: string; srclang: string }[];
  className?: string;
  onError: () => void;
  onLoadedData: () => void;
  src: string;
}

interface KeyboardControls {
  [key: string]: () => void;
}

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const CustomVideoPlayer = ({
  src,
  onLoadedData,
  onError,
  className,
  captions = [],
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
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    },
    []
  );

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

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
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
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
    const newVolume = value[0];
    if (videoRef.current) {
      if (videoRef.current && newVolume !== undefined) {
        videoRef.current.volume = newVolume;
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
      if (newMuted) {
        videoRef.current.volume = 0;
        setVolume(0);
      } else {
        videoRef.current.volume = 1;
        setVolume(1);
      }
    }
  }, [isMuted]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const keyboardControls: KeyboardControls = {
      " ": handlePlayPause,
      k: handlePlayPause,
      m: toggleMute,
      f: toggleFullscreen,
      ArrowLeft: skipLeft,
      ArrowRight: skipRight,
      ArrowUp: handleVolumeUp,
      ArrowDown: handleVolumeDown,
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

  const handleProgressChange = (value: number[]) => {
    if (videoRef.current) {
      const newTime = value[0];
      if (newTime !== undefined) {
        videoRef.current.currentTime = newTime;
      }
      if (newTime !== undefined) {
        setCurrentTime(newTime);
      }
    }
  };

  const handlePlaybackSpeedChange = (speed: string) => {
    const newSpeed = Number.parseFloat(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = newSpeed;
      setPlaybackSpeed(newSpeed);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2000);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Video player container needs mouse interactions
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Video player container needs mouse interactions
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-lg",
        isFullscreen && "h-screen",
        className
      )}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onMouseMove={handleMouseMove}
      ref={containerRef}
    >
      {/** biome-ignore lint/a11y/useMediaCaption: <video> element should have captions */}
      <video
        className="h-full w-full select-none outline-hidden focus:outline-hidden focus-visible:outline-none"
        onClick={handlePlayPause}
        onError={onError}
        onLoadedData={onLoadedData}
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

      <div className="absolute top-4 left-4 z-40 opacity-30 transition-opacity duration-300 hover:opacity-60">
        <span className="font-medium text-sm text-white drop-shadow-lg">
          Asocialmedia
        </span>
      </div>

      <div className="absolute inset-0 z-30 flex select-none">
        <button
          aria-label="Double click to rewind 10 seconds"
          className="h-full w-1/2 cursor-default"
          onDoubleClick={() => skip(-10)}
          type="button"
        />
        <button
          aria-label="Double click to forward 10 seconds"
          className="h-full w-1/2 cursor-default"
          onDoubleClick={() => skip(10)}
          type="button"
        />
      </div>

      <AnimatePresence>
        {isBuffering && (
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
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showControls && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-40 flex flex-col justify-between bg-gradient-to-t from-black/60 to-black/0"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              animate={{ y: 0, opacity: 1 }}
              className="flex items-center justify-end gap-2 p-4"
              exit={{ y: -20, opacity: 0 }}
              initial={{ y: -20, opacity: 0 }}
            >
              <div className="relative">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.button
                        className="rounded-full bg-black/30 p-2 backdrop-blur-md transition-all duration-200 hover:bg-black/50"
                        onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <Settings className="h-4 w-4 text-white/90" />
                      </motion.button>
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
                  {showSpeedMenu && (
                    <motion.div
                      animate={{
                        opacity: 1,
                        y: 0,
                        scale: 1,
                        transition: {
                          type: "spring",
                          stiffness: 300,
                          damping: 30,
                        },
                      }}
                      className="absolute top-full right-0 mt-2 origin-top-right"
                      exit={{
                        opacity: 0,
                        y: -5,
                        scale: 0.95,
                        transition: { duration: 0.15 },
                      }}
                      initial={{ opacity: 0, y: -5, scale: 0.95 }}
                    >
                      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/80 shadow-lg backdrop-blur-md">
                        <div className="p-2">
                          <p className="mb-2 px-2 font-medium text-white/60 text-xs">
                            Playback Speed
                          </p>
                          <div className="space-y-0.5">
                            {PLAYBACK_SPEEDS.map((speed) => (
                              <motion.button
                                className={cn(
                                  "w-full rounded-md px-3 py-1.5 text-left text-xs transition-all",
                                  playbackSpeed === speed
                                    ? "bg-white/20 text-white"
                                    : "text-white/70 hover:text-white"
                                )}
                                key={speed}
                                onClick={() =>
                                  handlePlaybackSpeedChange(speed.toString())
                                }
                                whileHover={{
                                  backgroundColor: "rgba(255,255,255,0.1)",
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span>{speed}x</span>
                                  {playbackSpeed === speed && (
                                    <motion.div
                                      animate={{ scale: 1 }}
                                      className="h-1.5 w-1.5 rounded-full bg-white"
                                      initial={{ scale: 0 }}
                                    />
                                  )}
                                </div>
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      className="rounded-full bg-black/30 p-2 backdrop-blur-xs transition-colors hover:bg-black/70"
                      onClick={toggleFullscreen}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      {isFullscreen ? (
                        <MinimizeIcon className="h-4 w-4 text-white/90" />
                      ) : (
                        <Maximize className="h-4 w-4 text-white/90" />
                      )}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </motion.div>

            <motion.div
              animate={{ y: 0, opacity: 1 }}
              className="space-y-2 p-4"
              exit={{ y: 20, opacity: 0 }}
              initial={{ y: 20, opacity: 0 }}
            >
              {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: Video progress controls need mouse interactions */}
              {/** biome-ignore lint/a11y/useSemanticElements: Video progress controls should use semantic elements */}
              <div
                aria-label="Video progress controls"
                className="group relative"
                onMouseEnter={() => setShowControls(true)}
                role="region"
              >
                <Slider
                  className="h-1 transition-all group-hover:h-1.5"
                  max={duration}
                  min={0}
                  onValueChange={handleProgressChange}
                  step={0.1}
                  value={[currentTime]}
                />
                <div className="mt-1 flex justify-between text-white/80 text-xs">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.button
                          className="rounded-full bg-black/50 p-2 backdrop-blur-xs transition-colors hover:bg-black/70"
                          onClick={() => skip(-10)}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <Rewind className="h-5 w-5 text-white" />
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Rewind 10s (←)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.button
                          className="rounded-full bg-black/50 p-3 backdrop-blur-xs transition-colors hover:bg-black/70"
                          onClick={handlePlayPause}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          {isPlaying ? (
                            <Pause className="h-6 w-6 text-white" />
                          ) : (
                            <Play className="h-6 w-6 text-white" />
                          )}
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Play/Pause (Space)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.button
                          className="rounded-full bg-black/50 p-2 backdrop-blur-xs transition-colors hover:bg-black/70"
                          onClick={() => skip(10)}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <FastForward className="h-5 w-5 text-white" />
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Forward 10s (→)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="relative flex items-center gap-2">
                  <div className="relative flex items-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button
                            className="rounded-full bg-black/30 p-2 backdrop-blur-md transition-all duration-200 hover:bg-black/50"
                            onClick={toggleMute}
                            onMouseEnter={() => setShowVolumeSlider(true)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            {isMuted || volume === 0 ? (
                              <VolumeX className="h-4 w-4 text-white/90" />
                            ) : (
                              <Volume2 className="h-4 w-4 text-white/90" />
                            )}
                          </motion.button>
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
                      {showVolumeSlider && (
                        <motion.div
                          animate={{
                            width: "140px",
                            opacity: 1,
                            transition: {
                              width: {
                                type: "spring",
                                stiffness: 300,
                                damping: 30,
                              },
                              opacity: {
                                duration: 0.2,
                              },
                            },
                          }}
                          className="ml-2 overflow-hidden"
                          exit={{
                            width: 0,
                            opacity: 0,
                            transition: {
                              width: {
                                duration: 0.2,
                              },
                              opacity: {
                                duration: 0.1,
                              },
                            },
                          }}
                          initial={{ width: 0, opacity: 0 }}
                          onMouseLeave={() => setShowVolumeSlider(false)}
                        >
                          <motion.div
                            animate={{ scale: 1 }}
                            className="flex items-center gap-3 rounded-full bg-black/30 px-3 py-2 backdrop-blur-md"
                            initial={{ scale: 0.95 }}
                          >
                            <Slider
                              className="relative flex h-4 w-full touch-none select-none items-center"
                              max={1}
                              min={0}
                              onValueChange={handleVolumeChange}
                              step={0.01}
                              value={[volume]}
                            >
                              <motion.div
                                className="relative h-1 w-full grow overflow-hidden rounded-full bg-white/20"
                                transition={{ duration: 0.2 }}
                                whileHover={{ height: "6px" }}
                              >
                                <motion.div
                                  animate={{ width: `${volume * 100}%` }}
                                  className="absolute h-full bg-white/90"
                                  initial={{ width: 0 }}
                                  style={{ width: `${volume * 100}%` }}
                                  transition={{
                                    type: "spring",
                                    stiffness: 300,
                                    damping: 30,
                                  }}
                                />
                              </motion.div>
                            </Slider>
                            <span className="min-w-8 text-right font-medium text-white/90 text-xs">
                              {Math.round(volume * 100)}%
                            </span>
                          </motion.div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHotkeys && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => setShowHotkeys(false)}
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
        )}
      </AnimatePresence>
    </div>
  );
};
