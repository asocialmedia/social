import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  Loader2,
  Play,
  X,
} from "lucide-react";
import Image from "next/image";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";

interface AttachmentPreviewProps {
  attachment: {
    file: File;
    isUploading: boolean;
    previewUrl?: string;
    progress?: number;
  };
  isGust?: boolean;
  onRemoveClick: () => void;
}

const AttachmentPreviewInner = ({
  attachment: { file, isUploading, progress, previewUrl: existingPreviewUrl },
  isGust = false,
  onRemoveClick,
}: AttachmentPreviewProps) => {
  const [objectUrl, setObjectUrl] = useState<string>(existingPreviewUrl || "");
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileName = file.name;

  useEffect(() => {
    if (!existingPreviewUrl) {
      const url = URL.createObjectURL(file);
      // eslint-disable-next-line react-compiler -- object URLs must be created after mount
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, existingPreviewUrl]);

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

    if (file.type.startsWith("image")) {
      return (
        <div className="bg-primary/5 relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-2xl">
          <Image
            alt={fileName}
            className="h-full w-full rounded-2xl object-cover"
            layout="fill"
            objectFit="cover"
            src={objectUrl}
          />
        </div>
      );
    }

    if (
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.type === "application/xml"
    ) {
      const language = getLanguageFromFileName(fileName);
      return (
        <div className="bg-primary/5 w-full rounded-2xl p-6">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center">
              <FileCode className="text-primary h-full w-full" />
            </div>
            <div className="w-full max-w-[250px] space-y-1">
              <p className="truncate text-center text-sm font-medium">
                {formatFileName(fileName)}
              </p>
              <p className="text-muted-foreground text-center text-xs">
                {language}
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (file.type.startsWith("video")) {
      // Custom preview player: a poster-style frame with a bespoke play
      // overlay instead of the browser's default controls.
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
            <source src={objectUrl} type={file.type} />
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
              <Play className="ml-0.5 size-6 fill-white text-white" />
            </span>
          </button>

          {/* File name chip for context */}
          <span className="absolute bottom-2 left-2 z-10 max-w-[80%] truncate rounded-full bg-black/50 px-2.5 py-0.5 text-xs text-white/90 backdrop-blur-md">
            {formatFileName(fileName)}
          </span>
        </div>
      );
    }

    if (file.type.startsWith("audio")) {
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
              <source src={objectUrl} type={file.type} />
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
              {file.type || "Document"}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "relative w-full transition-opacity duration-200",
        isUploading && "opacity-70"
      )}
    >
      {renderPreview()}

      {/* Real upload progress bar (bytes streamed to the server) */}
      {isUploading ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 rounded-b-2xl bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <Loader2 className="size-4 shrink-0 animate-spin text-white" />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-linear-to-r from-[#ff9500] to-[#e65500] transition-[width] duration-150 ease-linear"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
          <span className="w-9 text-right text-xs font-semibold text-white tabular-nums">
            {progress ?? 0}%
          </span>
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

export const AttachmentPreview = memo(AttachmentPreviewInner);
