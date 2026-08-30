"use client";

import type { Media } from "@asm/db";
import { Pause, Play } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  EQ_BAR_COUNT,
  EQ_FALLBACK_HEIGHTS,
  extractWaveform,
} from "@/components/posts/editor/waveform";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";

interface AudioPreviewProps {
  className?: string;
  fill?: boolean;
  media: Media;
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const AudioPreview = memo(
  ({ media, className, fill = false }: AudioPreviewProps) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);
    const waveformRowRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [waveform, setWaveform] = useState<number[] | null>(null);

    const audioUrl = `/api/media/${media.id}`;

    // Decode the audio bytes to build a track-accurate waveform visualizer.
    useEffect(() => {
      if (!audioUrl) {
        return;
      }
      let cancelled = false;
      const computeWaveform = async () => {
        try {
          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const AudioContextClass =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (!AudioContextClass) {
            return;
          }
          const context = new AudioContextClass();
          const decoded = await context.decodeAudioData(arrayBuffer);
          void context.close();
          if (!cancelled) {
            if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
              setDuration((prev) => (prev > 0 ? prev : decoded.duration));
            }
            setWaveform(
              extractWaveform(decoded.getChannelData(0), EQ_BAR_COUNT)
            );
          }
        } catch {
          // Fallback profile is used if audio decoding fails.
        }
      };
      void computeWaveform();
      return () => {
        cancelled = true;
      };
    }, [audioUrl]);

    // Clean up audio playback when component unmounts or page navigates.
    useEffect(() => {
      const handleStop = () => {
        const audio = activeAudioRef.current;
        if (audio) {
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {
            // Ignore
          }
        }
        setIsPlaying(false);
      };

      window.addEventListener("pagehide", handleStop);
      window.addEventListener("popstate", handleStop);

      return () => {
        handleStop();
        window.removeEventListener("pagehide", handleStop);
        window.removeEventListener("popstate", handleStop);
      };
    }, []);

    const handleTogglePlay = useCallback(async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const audio = activeAudioRef.current || audioRef.current;
      if (!audio) {
        return;
      }
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          setIsPlaying(false);
        }
      } else {
        audio.pause();
      }
    }, []);

    const seekToClientX = useCallback(
      async (clientX: number, target: HTMLElement) => {
        const audio = activeAudioRef.current || audioRef.current;
        if (!audio) {
          return;
        }
        const effectiveDuration =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : duration;
        if (!effectiveDuration || effectiveDuration <= 0) {
          return;
        }
        const rect = target.getBoundingClientRect();
        const fraction = Math.min(
          1,
          Math.max(0, (clientX - rect.left) / rect.width)
        );
        const targetTime = fraction * effectiveDuration;
        audio.currentTime = targetTime;
        setCurrentTime(targetTime);
        if (audio.paused) {
          try {
            await audio.play();
          } catch {
            setIsPlaying(false);
          }
        }
      },
      [duration]
    );

    const handleWaveformSeek = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        void seekToClientX(event.clientX, event.currentTarget);
      },
      [seekToClientX]
    );

    const handleWaveformSeekKey = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        event.stopPropagation();
        const audio = activeAudioRef.current || audioRef.current;
        const effectiveDuration =
          Number.isFinite(audio?.duration) && (audio?.duration ?? 0) > 0
            ? (audio?.duration ?? 0)
            : duration;
        if (!audio || effectiveDuration <= 0) {
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const delta = event.key === "ArrowRight" ? 5 : -5;
          const targetTime = Math.min(
            effectiveDuration,
            Math.max(0, audio.currentTime + delta)
          );
          audio.currentTime = targetTime;
          setCurrentTime(targetTime);
        }
      },
      [duration]
    );

    const progressFraction =
      duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const bars = waveform ?? EQ_FALLBACK_HEIGHTS;
    const playedUntilBar = Math.floor(progressFraction * bars.length);

    return (
      // oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div
        className={cn(
          "apple-panel relative w-full overflow-hidden rounded-2xl border border-white/10 p-3 sm:p-4",
          fill && "mx-auto max-w-2xl",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* oxlint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            aria-label={isPlaying ? "Pause audio" : "Play audio"}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-all hover:scale-105 hover:from-[#ff9f0a] hover:to-[#ea5b00] active:translate-y-px"
            onClick={handleTogglePlay}
            type="button"
          >
            {isPlaying ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-foreground truncate text-sm font-medium">
                {formatFileName(media.key)}
              </p>
              <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">
                {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
              </span>
            </div>

            {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the seek bar is the waveform itself; an <input type=range> cannot render the bars */}
            <div
              aria-label="Audio seek bar"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progressFraction * 100)}
              className="group/seek mt-2 flex h-10 cursor-pointer items-center gap-px select-none"
              onClick={handleWaveformSeek}
              onKeyDown={handleWaveformSeekKey}
              ref={waveformRowRef}
              role="slider"
              tabIndex={0}
            >
              {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
              {bars.map((height, index) => {
                const isWaveformLoading = waveform === null;
                const isPlayed = isWaveformLoading || index <= playedUntilBar;
                const isCurrent = isPlaying && index === playedUntilBar;
                return (
                  <span
                    aria-hidden
                    className={cn(
                      "flex-1 rounded-full transition-all duration-150",
                      isPlayed
                        ? "bg-linear-to-b from-[#ff9500] to-[#e65500]"
                        : "bg-zinc-500/30 group-hover/seek:bg-zinc-500/50",
                      (isWaveformLoading || (isPlaying && isPlayed)) &&
                        "asm-eq-bar",
                      isCurrent && "brightness-125"
                    )}
                    key={index}
                    style={{
                      animationDelay:
                        isWaveformLoading || isPlaying
                          ? `${-index * 0.04}s`
                          : undefined,
                      height: `${Math.max(0.12, height) * 100}%`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- audio content caption handled if WebVTT exists */}
        <audio
          aria-label={`Audio ${formatFileName(media.key)}`}
          className="hidden"
          onCanPlay={(event) => {
            const dur = event.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setDuration((prev) => (prev > 0 ? prev : dur));
            }
          }}
          onDurationChange={(event) => {
            const dur = event.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setDuration(dur);
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onError={() => setIsPlaying(false)}
          onLoadedMetadata={(event) => {
            const dur = event.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setDuration(dur);
            }
          }}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime;
            if (Number.isFinite(time)) {
              setCurrentTime(time);
            }
          }}
          preload="metadata"
          ref={(el) => {
            audioRef.current = el;
            if (el) {
              activeAudioRef.current = el;
            }
          }}
          src={audioUrl}
        />
      </div>
    );
  }
);

AudioPreview.displayName = "AudioPreview";
