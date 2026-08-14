import { FileAudioIcon, FileCode, FileIcon, X } from "lucide-react";
import Image from "next/image";
import { memo, useEffect, useState } from "react";

import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";

interface AttachmentPreviewProps {
  attachment: {
    file: File;
    isUploading: boolean;
    previewUrl?: string;
  };
  onRemoveClick: () => void;
}

const AttachmentPreviewInner = ({
  attachment: { file, isUploading, previewUrl: existingPreviewUrl },
  onRemoveClick,
}: AttachmentPreviewProps) => {
  const [objectUrl, setObjectUrl] = useState<string>(existingPreviewUrl || "");
  const fileName = file.name;

  useEffect(() => {
    if (!existingPreviewUrl) {
      const url = URL.createObjectURL(file);
      // eslint-disable-next-line react-compiler -- object URLs must be created after mount
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, existingPreviewUrl]);

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
      return (
        <div className="bg-primary/5 relative aspect-[16/9] w-full overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded preview, no caption source available */}
          <video
            className="h-full w-full object-cover"
            controls
            preload="metadata"
          >
            <source src={objectUrl} type={file.type} />
            Your browser does not support the video tag.
          </video>
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
        isUploading && "opacity-50"
      )}
    >
      {renderPreview()}
      {!isUploading && (
        <button
          aria-label="Remove attachment"
          className="bg-foreground text-background hover:bg-foreground/60 focus:ring-primary absolute top-3 right-3 rounded-full p-1.5 transition-colors focus:ring-2 focus:outline-hidden"
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
