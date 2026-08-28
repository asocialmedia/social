import noMediaImage from "@assets/general/nomedia.png";
import {
  FileIcon,
  FilmIcon,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Image from "next/image";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { formatFileName } from "@/lib/format-file-name";
import type { UploadStage } from "@/lib/media-upload-client";
import { cn } from "@/lib/utils";

import { EQ_BAR_COUNT, EQ_FALLBACK_HEIGHTS, extractWaveform } from "./waveform";

// How much of the track stays filled once bytes have landed, per REAL
// pipeline phase. Stages are genuine server states, so these widths are
// progress in the only honest unit available - completed stages - never a
// fabricated percentage.
const STAGE_FILL_FRACTION: Record<Exclude<UploadStage, "uploading">, number> = {
  processing: 0.88,
  queued: 0.45,
  scanning: 0.7,
};

interface AttachmentPreviewProps {
  attachment: {
    altText?: string;
    error?: string;
    file?: File;
    isUploading: boolean;
    mediaId?: string;
    mediaUrl?: string;
    name?: string;
    previewUrl?: string;
    progress?: number;
    stage?: UploadStage;
    type?: string;
  };
  isGust?: boolean;
  onCancelClick?: () => void;
  /** Gust only: tapping the preview body swaps the clip. */
  onChangeMediaClick?: () => void;
  onEditAltClick?: () => void;
  onRemoveClick: () => void;
  onRetryClick?: () => void;
}

const PROGRESS_BAR_3D =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.5),0_1px_2px_rgba(0,0,0,0.25)]";

/** m:ss clock used by the composer's compact video controls. */
function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const AttachmentPreviewInner = ({
  attachment: {
    altText,
    error,
    file,
    isUploading,
    mediaId,
    mediaUrl,
    name,
    progress,
    previewUrl: existingPreviewUrl,
    stage,
    type: fileType,
  },
  isGust = false,
  onCancelClick,
  onChangeMediaClick,
  onEditAltClick,
  onRemoveClick,
  onRetryClick,
}: AttachmentPreviewProps) => {
  const [objectUrl, setObjectUrl] = useState<string>(
    existingPreviewUrl || mediaUrl || ""
  );
  // Real per-bar peaks decoded from the audio file itself; null until the
  // decode finishes, so the visualizer falls back to a flat-ish profile.
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Flips once the <video> paints real pixels; the film-icon placeholder
  // underneath shows through until then (no black-void flash).
  const [hasFirstFrame, setHasFirstFrame] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Restored drafts of rows still mid-pipeline get 404s from the serving
  // gate until READY; fall back to the placeholder instead of a broken img.
  const handlePreviewError = useCallback(() => {
    setPreviewFailed(true);
  }, []);
  // Restored attachments carry a name but no File; fresh ones use file.name.
  const fileName = name || file?.name || "attachment";
  const mimeType = fileType || file?.type || "";

  useEffect(() => {
    // Fresh uploads preview from a blob; restored ones already have a media
    // URL so there is nothing to create.
    if (file && !existingPreviewUrl && !mediaUrl) {
      const url = URL.createObjectURL(file);
      // eslint-disable-next-line react-compiler -- object URLs must be created after mount
      // oxlint-disable-next-line react/set-state-in-effect -- the blob URL only comes from the browser's object registry after mount (creating it during render would leak under StrictMode double-invoke), and the previous URL must stay revocable on file change
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, existingPreviewUrl, mediaUrl]);

  const handleTogglePlay = useCallback(() => {
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

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const handleToggleAudioPlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const waveformRowRef = useRef<HTMLDivElement>(null);

  // Click the waveform to seek: the fraction under the pointer becomes the
  // new position, then playback starts (SoundCloud-style tap-to-play).
  const handleWaveformSeek = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const audio = audioRef.current;
      const row = waveformRowRef.current;
      if (
        !audio ||
        !row ||
        !Number.isFinite(audio.duration) ||
        audio.duration <= 0
      ) {
        return;
      }
      const rect = row.getBoundingClientRect();
      const fraction = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width)
      );
      audio.currentTime = fraction * audio.duration;
      if (audio.paused) {
        void audio.play();
      }
    },
    []
  );

  const handleWaveformSeekKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 5 : -5;
        audio.currentTime = Math.min(
          audio.duration,
          Math.max(0, audio.currentTime + delta)
        );
      }
    },
    []
  );

  // Decode the audio bytes (blob for fresh uploads, media URL for restored
  // drafts) and shape the visualizer from the track's own waveform.
  useEffect(() => {
    if (!mimeType.startsWith("audio") || !objectUrl) {
      return;
    }
    let cancelled = false;
    const computeWaveform = async () => {
      try {
        const response = await fetch(objectUrl);
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
          setWaveform(extractWaveform(decoded.getChannelData(0), EQ_BAR_COUNT));
        }
      } catch {
        // Undecodable bytes keep the fallback profile; the player still works.
      }
    };
    void computeWaveform();
    return () => {
      cancelled = true;
    };
  }, [mimeType, objectUrl]);

  // Gust clips are 9:16 portrait; regular video attachments follow the
  // standard post aspect.

  const renderPreview = () => {
    if (!objectUrl || previewFailed) {
      // Gust empty state is a reels-shaped dropzone; fleet stays 16:9 placeholder.
      if (isGust) {
        return (
          <div className="apple-panel reels-panel relative mx-auto flex aspect-9/16 w-full max-w-xs items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-white/15">
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                <FilmIcon className="size-6 text-white/80" />
              </div>
              <p className="text-sm font-semibold text-white">
                Drop your gust here
              </p>
              <p className="text-xs text-white/60">9:16 portrait recommended</p>
            </div>
          </div>
        );
      }
      return (
        <div className="apple-panel relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl">
          <Image
            alt={fileName}
            className="h-full w-full object-cover opacity-50"
            sizes="(max-width: 768px) 100vw, 512px"
            src={noMediaImage}
          />
        </div>
      );
    }

    if (mimeType.startsWith("image")) {
      return (
        <div className="apple-panel relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl">
          <Image
            alt={fileName}
            className="h-full w-full rounded-2xl object-cover"
            fill
            onError={handlePreviewError}
            sizes="(max-width: 768px) 100vw, 512px"
            src={objectUrl}
          />
        </div>
      );
    }

    if (mimeType.startsWith("video")) {
      // Custom preview player: a poster-style frame with a bespoke play/pause
      // overlay instead of the browser's default controls. The icon flips to a
      // pause mark while the clip is playing.
      //
      // Width: single videos fill the composer column like images do; only
      // portrait gust clips stay column-capped (a full-width 9:16 block would
      // tower over the editor). The pipeline poster (?thumb=1) becomes the
      // thumbnail as soon as the row is READY; the #t=0.1 fragment forces
      // browsers to paint the first local frame immediately instead of black.
      const posterUrl = mediaId ? `/api/media/${mediaId}?thumb=1` : undefined;
      return (
        <div
          className={cn(
            "apple-panel group/video relative overflow-hidden rounded-2xl",
            isGust
              ? "mx-auto aspect-9/16 w-full max-w-xs"
              : "aspect-video w-full"
          )}
          style={isGust ? { maxHeight: "70vh" } : undefined}
        >
          {/* Gust reels frame: a blurred, scaled copy of the clip fills the
              9:16 frame behind the contained video, so landscape sources
              never crop and never leave a void (Instagram-style fill). */}
          {isGust ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- decorative blurred fill, same user-uploaded clip */}
              <video
                aria-hidden
                className="absolute inset-0 z-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
                loop
                muted
                playsInline
                preload="metadata"
                src={objectUrl}
              />
              {hasFirstFrame ? null : (
                <div className="bg-muted/20 absolute inset-0 z-0" />
              )}
            </>
          ) : null}
          {/* First-frame placeholder: visible until the browser paints real
              pixels, so uploads never flash a black void. */}
          {hasFirstFrame ? null : (
            <div className="text-muted-foreground/40 absolute inset-0 z-1 flex items-center justify-center">
              <FilmIcon className="size-12" />
            </div>
          )}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded preview, no caption source available */}
          <video
            className={cn(
              "absolute inset-0 z-1 h-full w-full",
              isGust ? "object-contain" : "object-cover"
            )}
            loop
            muted={isMuted}
            onLoadedData={() => setHasFirstFrame(true)}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration || 0);
            }}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onTimeUpdate={(event) => {
              setCurrentTime(event.currentTarget.currentTime);
            }}
            playsInline
            poster={posterUrl}
            preload="metadata"
            ref={videoRef}
          >
            {/* #t=0.1: Chromium/Safari skip first-frame painting without it. */}
            <source src={`${objectUrl}#t=0.1`} type={mimeType} />
            Your browser does not support the video tag.
          </video>

          {/* File name chip, top-left for context at a glance */}
          <span className="rail-3d-btn pointer-events-none absolute top-2 left-2 z-10 flex h-7 max-w-[70%] items-center rounded-full px-2.5 text-xs font-medium">
            <span className="truncate">{formatFileName(fileName)}</span>
          </span>

          {/* Mute toggle, bottom-left - 3D dual-border glass over video */}
          <button
            aria-label={isMuted ? "Unmute video" : "Mute video"}
            className="rail-3d-btn absolute bottom-2 left-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full p-0"
            onClick={handleToggleMute}
            type="button"
          >
            {isMuted ? (
              <VolumeX className="size-3.5" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
          </button>

          {/* Play/pause + duration cluster, bottom-right - 3D dual-border glass */}
          <div className="rail-3d-btn absolute right-2 bottom-2 z-10 flex h-7 items-center gap-1.5 rounded-full px-1.5">
            <button
              aria-label={isPlaying ? "Pause video" : "Play video"}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-white transition-colors hover:text-white/80"
              onClick={handleTogglePlay}
              type="button"
            >
              {isPlaying ? (
                <Pause className="size-3 fill-white" />
              ) : (
                <Play className="ml-px size-3 fill-white" />
              )}
            </button>
            <span className="text-[10px] font-medium text-white tabular-nums">
              {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
            </span>
          </div>
        </div>
      );
    }

    if (mimeType.startsWith("audio")) {
      // SoundCloud-style player: play/pause on the left, an equalizer of
      // vertical bars that animates while playing, filename + time above.
      // The native audio element is hidden and driven through a ref.
      return (
        <div className="apple-panel relative w-full overflow-hidden rounded-2xl">
          <div className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
            <button
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-all hover:from-[#ff9f0a] hover:to-[#ea5b00] active:translate-y-px"
              onClick={handleToggleAudioPlay}
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
                <p className="truncate text-sm font-medium">
                  {formatFileName(fileName)}
                </p>
                <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">
                  {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                </span>
              </div>
              {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the seek bar is the waveform itself; an <input type=range> cannot render the bars */}
              <div
                aria-label="Audio seek bar"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(progressFraction * 100)}
                className="group/seek mt-2 flex h-10 cursor-pointer items-center gap-px"
                onClick={handleWaveformSeek}
                onKeyDown={handleWaveformSeekKey}
                ref={waveformRowRef}
                role="slider"
                tabIndex={0}
              >
                {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
                {(waveform ?? EQ_FALLBACK_HEIGHTS).map((height, index) => {
                  const isWaveformLoading = waveform === null;
                  const isPlayed = isWaveformLoading || index < playedUntilBar;
                  return (
                    <span
                      aria-hidden
                      className={cn(
                        "flex-1 rounded-full transition-colors duration-200",
                        isPlayed
                          ? "bg-linear-to-b from-[#ff9500] to-[#e65500]"
                          : "bg-zinc-500/40",
                        (isWaveformLoading || (isPlaying && isPlayed)) &&
                          "asm-eq-bar"
                      )}
                      key={index}
                      style={{
                        animationDelay:
                          isWaveformLoading || isPlaying
                            ? `${-index * 0.06}s`
                            : undefined,
                        height: `${height * 100}%`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Native audio drives playback; the visualizer is the control UI. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded preview, no caption source available */}
          <audio
            aria-label={`Audio ${fileName}`}
            className="hidden"
            onDurationChange={(event) => {
              if (Number.isFinite(event.currentTarget.duration)) {
                setDuration(event.currentTarget.duration);
              }
            }}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onTimeUpdate={(event) => {
              setCurrentTime(event.currentTarget.currentTime);
            }}
            preload="metadata"
            ref={audioRef}
          >
            <source src={objectUrl} type={mimeType} />
            Your browser does not support the audio element.
          </audio>
        </div>
      );
    }

    return (
      <div className="apple-panel w-full rounded-2xl p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center">
            <FileIcon className="text-primary h-full w-full" />
          </div>
          <div className="w-full max-w-62.5 space-y-1">
            <p className="truncate text-center text-sm font-medium">
              {formatFileName(fileName)}
            </p>
            <p className="text-muted-foreground text-center text-xs">
              {mimeType || "Document"}
            </p>
          </div>
        </div>
      </div>
    );
  };

  // Seek-bar state: bars up to the played fraction are "played" (orange), the
  // rest stay gray until reached.
  const progressFraction =
    duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const playedUntilBar = progressFraction * EQ_BAR_COUNT;

  // Dim the asset while uploading or when it has failed (so the retry bar pops)
  const hasError = Boolean(error);

  // The floating ALT chip clears the bottom-left media controls: video's mute
  // toggle (40px), audio's larger play button (64px), or the tile edge.
  let altChipPosition = "left-2";
  if (fileType?.startsWith("video")) {
    altChipPosition = "left-10";
  } else if (fileType?.startsWith("audio")) {
    altChipPosition = "left-16";
  }

  let errorTitle: string;
  // oxlint-disable unicorn/prefer-ternary -- nested ternary is banned, keep explicit if/else for error title
  if (error?.includes("Still processing")) {
    if (stage) {
      errorTitle = `Timed out at ${stageText(stage).toLowerCase()} - retry to continue`;
    } else {
      errorTitle = "Timed out at processing - retry to continue";
    }
  } else {
    errorTitle = error || "Upload failed";
  }
  // oxlint-enable unicorn/prefer-ternary

  let actionBar: React.ReactNode;
  if (isUploading) {
    actionBar = (
      <div className="mt-2 flex items-center gap-3">
        <div
          className={cn(
            "relative h-2 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10",
            PROGRESS_BAR_3D
          )}
        >
          <div
            className={cn(
              "asm-progress-fill relative h-full overflow-hidden rounded-full bg-linear-to-r from-[#ff9500] to-[#e65500] transition-[width] duration-500 ease-out",
              stage !== "uploading" && "asm-progress-active"
            )}
            style={{
              width:
                stage === "uploading"
                  ? `${progress ?? 0}%`
                  : `${(STAGE_FILL_FRACTION[stage ?? "queued"] ?? 0.45) * 100}%`,
            }}
          >
            {stage === "uploading" ? null : (
              <span aria-hidden className="asm-progress-shine" />
            )}
          </div>
        </div>
        <span className="text-muted-foreground shrink-0 text-xs font-semibold tabular-nums">
          {stage === "uploading" ? `${progress ?? 0}%` : stageText(stage)}
        </span>
        <button
          aria-label="Cancel upload"
          className="icon-btn-3d icon-btn-3d-danger flex h-7 w-7 shrink-0 items-center justify-center rounded-full p-0"
          onClick={onCancelClick}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  } else if (hasError) {
    actionBar = (
      <div className="apple-panel mt-2 flex items-center gap-2.5 rounded-2xl p-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#3a3f4a] to-[#23262e] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_6px_rgba(0,0,0,0.35)]">
          <RefreshCw className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{errorTitle}</p>
          {stage ? (
            <p className="text-muted-foreground truncate text-[11px]">
              Failed at {stageText(stage).toLowerCase()} · will resume where it
              left off
            </p>
          ) : null}
        </div>
        <button
          aria-label="Retry upload"
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] px-3.5 text-xs font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-all hover:from-[#ff9f0a] hover:to-[#ea5b00] active:translate-y-px"
          onClick={onRetryClick}
          type="button"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
        <button
          aria-label="Remove attachment"
          className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0"
          onClick={onRemoveClick}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  } else {
    actionBar = (
      <button
        aria-label="Remove attachment"
        className="icon-btn-3d absolute top-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full p-0 focus-visible:ring-2 focus-visible:ring-offset-2"
        onClick={onRemoveClick}
        type="button"
      >
        <X size={16} />
      </button>
    );
  }

  // Bare-tile clicks open the alt text editor - or, on gust tiles, swap the
  // clip. Inner playback controls own their own clicks, so anything inside a
  // button or an audio element is ignored; the gust video body itself is
  // tappable (it carries no native controls), while regular video bodies
  // stay inert.
  const handleTileClick = (event: React.MouseEvent) => {
    if (hasError) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, audio")) {
      return;
    }
    if (isGust) {
      onChangeMediaClick?.();
      return;
    }
    if ((event.target as HTMLElement).closest("video")) {
      return;
    }
    onEditAltClick?.();
  };

  const handleTileKeyDown = (event: React.KeyboardEvent) => {
    if (hasError) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (isGust) {
      onChangeMediaClick?.();
      return;
    }
    onEditAltClick?.();
  };

  const tileActivatable =
    !hasError &&
    (isGust ? Boolean(onChangeMediaClick) : Boolean(onEditAltClick));

  return (
    <div className="relative w-full">
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- see above; a semantic button cannot wrap media controls */}
      <div
        aria-disabled={!tileActivatable}
        className={cn(
          "transition-opacity duration-200",
          (isUploading || hasError) && "opacity-60",
          tileActivatable && "cursor-pointer"
        )}
        onClick={handleTileClick}
        onKeyDown={handleTileKeyDown}
      >
        {renderPreview()}
      </div>
      {/* The ALT chip is a post-mode affordance: gust's alt field is docked
          under the caption input, so the video tile stays clean of badges. */}
      {onEditAltClick && !isGust && !isUploading && !hasError ? (
        <button
          aria-label={altText ? "Edit alt text" : "Add alt text to this media"}
          className={cn(
            "rail-3d-btn absolute bottom-2 z-10 flex h-7 max-w-[70%] cursor-pointer items-center rounded-full p-0 px-2.5 text-xs font-medium",
            altChipPosition
          )}
          onClick={onEditAltClick}
          type="button"
        >
          <span className="truncate">{altText ? "ALT" : "Add alt text"}</span>
        </button>
      ) : null}
      {actionBar}
    </div>
  );
};

function stageText(stage?: UploadStage): string {
  switch (stage) {
    case "queued": {
      return "Queued…";
    }
    case "scanning": {
      return "Scanning…";
    }
    case "processing": {
      return "Processing…";
    }
    default: {
      return "Uploading…";
    }
  }
}

export const AttachmentPreview = memo(AttachmentPreviewInner);
