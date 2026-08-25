import {
  Check,
  FileAudioIcon,
  FileIcon,
  Loader2,
  Pause,
  Play,
  ScanSearch,
  UploadCloud,
  X,
} from "lucide-react";
import Image from "next/image";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { formatFileName } from "@/lib/format-file-name";
import type { UploadStage } from "@/lib/media-upload-client";
import { cn } from "@/lib/utils";

interface AttachmentPreviewProps {
  attachment: {
    file?: File;
    isUploading: boolean;
    mediaUrl?: string;
    name?: string;
    previewUrl?: string;
    progress?: number;
    stage?: UploadStage;
    type?: string;
  };
  isGust?: boolean;
  onCancelClick?: () => void;
  onRemoveClick: () => void;
}

const PROGRESS_BAR_3D =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.5),0_1px_2px_rgba(0,0,0,0.25)]";

const AttachmentPreviewInner = ({
  attachment: {
    file,
    isUploading,
    mediaUrl,
    name,
    progress,
    previewUrl: existingPreviewUrl,
    stage,
    type: fileType,
  },
  isGust = false,
  onCancelClick,
  onRemoveClick,
}: AttachmentPreviewProps) => {
  const [objectUrl, setObjectUrl] = useState<string>(
    existingPreviewUrl || mediaUrl || ""
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
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

  // Gust clips are 9:16 portrait; regular video attachments follow the
  // standard post aspect.
  const videoAspect = isGust ? "aspect-[9/16]" : "aspect-[16/9]";

  const renderPreview = () => {
    if (!objectUrl) {
      return null;
    }

    if (mimeType.startsWith("image")) {
      return (
        <div className="bg-primary/5 relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-2xl">
          <Image
            alt={fileName}
            className="h-full w-full rounded-2xl object-cover"
            fill
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
      return (
        <div
          className={cn(
            "bg-primary/5 group/video relative w-full max-w-md overflow-hidden rounded-2xl",
            videoAspect
          )}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded preview, no caption source available */}
          <video
            className="absolute inset-0 h-full w-full object-cover"
            loop
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            playsInline
            preload="metadata"
            ref={videoRef}
          >
            <source src={objectUrl} type={mimeType} />
            Your browser does not support the video tag.
          </video>

          {/* Bespoke play/pause control */}
          <button
            aria-label={isPlaying ? "Pause video" : "Play video"}
            className="absolute inset-0 z-10 flex h-full w-full items-center justify-center border-0 bg-transparent"
            onClick={handleTogglePlay}
            type="button"
          >
            <span
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-all duration-200",
                isPlaying
                  ? "scale-90 opacity-0 group-hover/video:opacity-100"
                  : "opacity-100"
              )}
            >
              {isPlaying ? (
                <Pause className="size-6 fill-white text-white" />
              ) : (
                <Play className="ml-0.5 size-6 fill-white text-white" />
              )}
            </span>
          </button>

          {/* File name chip for context */}
          <span className="absolute bottom-2 left-2 z-10 max-w-[80%] truncate rounded-full bg-black/50 px-2.5 py-0.5 text-xs text-white/90 backdrop-blur-md">
            {formatFileName(fileName)}
          </span>
        </div>
      );
    }

    if (mimeType.startsWith("audio")) {
      return (
        <div className="bg-primary/5 w-full rounded-2xl p-6">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center">
              <FileAudioIcon className="text-primary h-full w-full" />
            </div>
            <div className="w-full max-w-[250px] px-2">
              <p className="truncate text-center text-sm font-medium">
                {formatFileName(fileName)}
              </p>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded preview, no caption source available */}
            <audio className="w-full max-w-md" controls preload="metadata">
              <source src={objectUrl} type={mimeType} />
              Your browser does not support the audio element.
            </audio>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-primary/5 w-full rounded-2xl p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center">
            <FileIcon className="text-primary h-full w-full" />
          </div>
          <div className="w-full max-w-[250px] space-y-1">
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

  return (
    <div className="relative w-full">
      {/* Dim the asset while it is still uploading */}
      <div
        className={cn(
          "transition-opacity duration-200",
          isUploading && "opacity-50"
        )}
      >
        {renderPreview()}
      </div>

      {/* Pipeline status below the asset while it works: real byte progress
          during upload, then the actual server stages from the status poll.
          Nothing here is simulated - each phase flip comes from the API. */}
      {isUploading ? (
        <div className="mt-2 flex items-center gap-3">
          {stage === "uploading" ? (
            <>
              <div
                className={cn(
                  "relative h-2 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10",
                  PROGRESS_BAR_3D
                )}
              >
                <div
                  className="h-full rounded-full bg-linear-to-r from-[#ff9500] to-[#e65500] transition-[width] duration-150 ease-linear"
                  style={{ width: `${progress ?? 0}%` }}
                />
              </div>
              <span className="text-muted-foreground w-9 text-right text-xs font-semibold tabular-nums">
                {progress ?? 0}%
              </span>
            </>
          ) : (
            <StageStepper stage={stage} />
          )}
          <button
            aria-label="Cancel upload"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-full p-1 transition-colors"
            onClick={onCancelClick}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          aria-label="Remove attachment"
          className="bg-foreground text-background hover:bg-foreground/60 focus:ring-primary absolute top-3 right-3 z-20 rounded-full p-1.5 transition-colors focus:ring-2 focus:outline-hidden"
          onClick={onRemoveClick}
          type="button"
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
};

/** Compact pipeline readout: Upload → Scan → Process, driven by real poll
 * statuses. Completed steps tick, the active step spins, pending ones dim. */
const StageStepper = ({ stage }: { stage?: UploadStage }) => {
  const steps = [
    { icon: UploadCloud, key: "uploaded", label: "Uploaded" },
    { icon: ScanSearch, key: "scanning", label: "Scanning" },
    { icon: Loader2, key: "processing", label: "Processing" },
  ] as const;
  let activeIndex = 0;
  if (stage === "queued" || stage === "scanning") {
    activeIndex = 1;
  } else if (stage === "processing") {
    activeIndex = 2;
  }

  return (
    <div className="bg-muted/60 flex h-7 flex-1 items-center gap-1 rounded-full px-2">
      {steps.map((step, index) => {
        const isDone = index < activeIndex;
        const isActive = index === activeIndex;
        const Icon = step.icon;
        return (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
              isDone && "text-primary",
              !isActive && !isDone && "text-muted-foreground/40"
            )}
            key={step.key}
          >
            {isDone ? (
              <Check className="size-3" />
            ) : (
              <Icon className={cn("size-3", isActive && "animate-spin")} />
            )}
            <span className={cn(!isActive && "hidden sm:inline")}>
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
};

export const AttachmentPreview = memo(AttachmentPreviewInner);
