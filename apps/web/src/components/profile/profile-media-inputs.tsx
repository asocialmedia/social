"use client";

import { clientLog } from "@asm/config/debug";
import type { PrivateUserData } from "@asm/db";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import type { StaticImageData } from "next/image";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Resizer from "react-image-file-resizer";

import CropImageDialog from "@/components/layouts/crop-image-dialog";
import GifCenteringDialog from "@/components/layouts/gif-centering-dialog";
import Spinner3D from "@/components/layouts/spinner-3d";
import { useToast } from "@/lib/gooey-toast";
import type { UploadStage } from "@/lib/media/media-upload-client";
import { cn } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

// Avatar + header upload inputs, shared by the edit-profile dialog and the
// settings profile tab. Each input owns its own file picking, resize, crop and
// GIF-centering flow and reports the result upward; the parent decides when to
// upload (dialog Save, or the settings form's Save Changes).

export function pipelineStageLabel(
  stage: UploadStage | null,
  progress: number,
  kind: "avatar" | "banner"
): string {
  if (!stage) {
    return "Processing…";
  }
  switch (stage) {
    case "uploading": {
      return `Uploading ${progress}%`;
    }
    case "queued": {
      return "Queued for processing";
    }
    case "scanning": {
      return "Scanning for threats…";
    }
    case "processing": {
      return kind === "banner" ? "Processing header…" : "Processing avatar…";
    }
    default: {
      return "Processing…";
    }
  }
}

export interface BannerInputProps {
  canRemove: boolean;
  // Sizing/rounding override for the preview button (the settings hero wants
  // a taller, flush-topped banner than the dialog's compact square one).
  className?: string;
  isRemoved: boolean;
  isUploading: boolean;
  onBannerCropped: (blob: Blob | null) => void;
  onGifSelected: (file: File | null) => void;
  onRemove: () => void;
  progress?: number;
  stage?: UploadStage | null;
  src: string;
  user: PrivateUserData;
}

export const BannerInput = ({
  src,
  canRemove,
  className,
  isRemoved,
  onBannerCropped,
  onGifSelected,
  onRemove,
  isUploading,
  progress = 0,
  stage = null,
  user,
}: BannerInputProps) => {
  const { toast } = useToast();
  const [imageToCrop, setImageToCrop] = useState<File>();
  const [gifToCenter, setGifToCenter] = useState<File>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bannerSrc = useMemo(() => {
    if (src && !src.startsWith("blob:")) {
      return getSecureImageUrl(src);
    }
    return src;
  }, [src]);

  const resetInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onImageSelected = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        toast({
          description: "That image is over 10MB, try a smaller one",
          title: "File Too Big",
          variant: "destructive",
        });
        return;
      }

      // GIFs must skip the resizer and crop dialog - both flatten animation.
      // They go through the centering dialog and upload raw, like avatars.
      if (file.type === "image/gif") {
        setGifToCenter(file);
        onGifSelected(file);
        return;
      }

      try {
        Resizer.imageFileResizer(
          file,
          1500,
          500,
          "WEBP",
          90,
          0,
          (uri) => setImageToCrop(uri as File),
          "file",
          1500,
          500
        );
      } catch (error) {
        clientLog.error("Error resizing image:", error);
        toast({
          description: "That image didn't work, try a different one",
          title: "Couldn't Process Image",
          variant: "destructive",
        });
        resetInput();
      }
    },
    [toast, onGifSelected, resetInput]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onImageSelected(e.target.files?.[0]);
    },
    [onImageSelected]
  );

  const handleBannerClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleGifClose = useCallback(() => {
    setGifToCenter(undefined);
    onGifSelected(null);
    resetInput();
  }, [onGifSelected, resetInput]);

  const handleCropClose = useCallback(() => {
    setImageToCrop(undefined);
    resetInput();
  }, [resetInput]);

  const handleCropped = useCallback(
    (blob: Blob | null) => {
      if (blob) {
        onBannerCropped(blob);
      }
    },
    [onBannerCropped]
  );

  const handleRemoveClick = useCallback(() => {
    onRemove();
    resetInput();
  }, [onRemove, resetInput]);

  const cropUrl = useMemo(
    () => (imageToCrop ? URL.createObjectURL(imageToCrop) : null),
    [imageToCrop]
  );

  useEffect(
    () => () => {
      if (cropUrl) {
        URL.revokeObjectURL(cropUrl);
      }
    },
    [cropUrl]
  );

  return (
    <>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <div className="relative">
        <button
          className={cn(
            "group border-border/60 relative block h-28 w-full overflow-hidden rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
            className
          )}
          disabled={isUploading}
          onClick={handleBannerClick}
          type="button"
        >
          {bannerSrc && !isRemoved ? (
            <Image
              alt="Header preview"
              className="object-cover"
              fill
              sizes="480px"
              src={bannerSrc}
              unoptimized
            />
          ) : (
            <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 bg-linear-to-br from-[#ff9500]/10 via-transparent to-[#e65500]/10 text-sm">
              <ImagePlus className="h-4 w-4" />
              Add a header image
            </div>
          )}
          {isUploading ? (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 px-3 text-center backdrop-blur-[2px]">
              <Spinner3D className="size-10" />
              <span className="max-w-full truncate text-xs font-medium text-white">
                {pipelineStageLabel(stage, progress, "banner")}
              </span>
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
              <Pencil className="h-6 w-6 text-white" fill="currentColor" />
            </span>
          )}
        </button>

        {/* Trash sits on the image itself instead of a separate full-width
            row below; sibling of the preview button so buttons never nest. */}
        {canRemove && !isRemoved ? (
          <button
            aria-label="Remove header image"
            className="hover:bg-destructive absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full border-0 bg-black/50 text-white backdrop-blur-sm transition-colors duration-200 active:translate-y-px"
            disabled={isUploading}
            onClick={handleRemoveClick}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>

      {gifToCenter ? (
        <GifCenteringDialog
          currentValues={{ userId: user.id }}
          gifFile={gifToCenter}
          onClose={handleGifClose}
          target="banner"
        />
      ) : null}

      {imageToCrop && cropUrl ? (
        <CropImageDialog
          cropAspectRatio={3}
          onClose={handleCropClose}
          onCropped={handleCropped}
          src={cropUrl}
        />
      ) : null}
    </>
  );
};

export interface AvatarInputProps {
  canDelete: boolean;
  // Sizing override for the avatar in the bare variant (the settings hero
  // controls diameter and ring directly).
  className?: string;
  isDeleted: boolean;
  isUploading: boolean;
  onDelete: () => void;
  onGifSelected: (file: File | null) => void;
  onImageCropped: (blob: Blob | null) => void;
  progress?: number;
  // "circle" (profile picture) or "squircle" (rounded-square app-icon look).
  shape?: "circle" | "squircle";
  stage?: UploadStage | null;
  src: string | StaticImageData;
  user: PrivateUserData;
  // "row" is the dialog's bordered row with helper copy; "bare" is just the
  // circular control, for the settings hero.
  variant?: "bare" | "row";
}

export const AvatarInput = (props: AvatarInputProps) => {
  const {
    canDelete,
    className,
    isDeleted,
    isUploading,
    onDelete,
    onGifSelected,
    onImageCropped,
    progress = 0,
    shape = "circle",
    stage = null,
    user,
    variant = "row",
    src,
  } = props;
  const { toast } = useToast();
  const [imageToCrop, setImageToCrop] = useState<File>();
  const [gifToCenter, setGifToCenter] = useState<File>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const avatarSrc = useMemo(() => {
    if (typeof src === "string" && !src.startsWith("blob:")) {
      return getSecureImageUrl(src);
    }
    return typeof src === "string" ? src : avatarPlaceholder.src;
  }, [src]);

  const resetInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onImageSelected = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        toast({
          description: "That image is over 10MB, try a smaller one",
          title: "File Too Big",
          variant: "destructive",
        });
        return;
      }

      if (file.type === "image/gif") {
        setGifToCenter(file);
        onGifSelected(file);
        return;
      }

      try {
        Resizer.imageFileResizer(
          file,
          1024,
          1024,
          "WEBP",
          90,
          0,
          (uri) => setImageToCrop(uri as File),
          "file",
          512,
          512
        );
      } catch (error) {
        clientLog.error("Error resizing image:", error);
        toast({
          description: "That image didn't work, try a different one",
          title: "Couldn't Process Image",
          variant: "destructive",
        });
        resetInput();
      }
    },
    [toast, onGifSelected, resetInput]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onImageSelected(e.target.files?.[0]);
    },
    [onImageSelected]
  );

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarError = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      (e.target as HTMLImageElement).src = avatarPlaceholder.src;
    },
    []
  );

  const handleGifClose = useCallback(() => {
    setGifToCenter(undefined);
    resetInput();
  }, [resetInput]);

  const handleCropClose = useCallback(() => {
    setImageToCrop(undefined);
    resetInput();
  }, [resetInput]);

  const handleCropped = useCallback(
    (blob: Blob | null) => {
      if (blob) {
        onImageCropped(blob);
      }
    },
    [onImageCropped]
  );

  const cropUrl = useMemo(
    () => (imageToCrop ? URL.createObjectURL(imageToCrop) : null),
    [imageToCrop]
  );

  useEffect(
    () => () => {
      if (cropUrl) {
        URL.revokeObjectURL(cropUrl);
      }
    },
    [cropUrl]
  );

  // Continuous-curvature-ish rounding: a large radius reads as a squircle
  // (app-icon) shape, the default is a plain circle.
  const shapeClass = shape === "squircle" ? "rounded-[30%]" : "rounded-full";

  const avatarControl = (
    <div className="relative shrink-0">
      <button
        className="group relative block"
        disabled={isUploading}
        onClick={handleAvatarClick}
        type="button"
      >
        <Image
          alt="Avatar preview"
          className={cn(
            "avatar-ring size-24 flex-none object-cover",
            shapeClass,
            isUploading && "opacity-50",
            className
          )}
          height={150}
          onError={handleAvatarError}
          src={avatarSrc}
          unoptimized
          width={150}
        />
        {isUploading ? (
          <span
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 px-2 text-center backdrop-blur-[2px]",
              shapeClass
            )}
          >
            <Spinner3D className="size-8" />
            <span className="max-w-full truncate px-1 text-[11px] leading-none font-medium text-white">
              {pipelineStageLabel(stage, progress, "avatar")}
            </span>
          </span>
        ) : (
          <span
            className={cn(
              "absolute inset-0 m-auto flex size-10 items-center justify-center bg-black/40 text-white transition-opacity duration-200 group-hover:bg-black/30 md:opacity-0 md:group-hover:opacity-100",
              shapeClass
            )}
          >
            <Pencil size={20} fill="currentColor" />
          </span>
        )}
      </button>
      {canDelete && !isDeleted ? (
        <button
          aria-label="Remove avatar"
          className="hover:bg-destructive absolute top-1 right-1 z-10 flex size-6 items-center justify-center rounded-full border-0 bg-black/50 text-white transition-colors duration-200 active:translate-y-px"
          disabled={isUploading}
          onClick={onDelete}
          type="button"
        >
          <Trash2 className="size-3" />
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />

      {variant === "bare" ? (
        avatarControl
      ) : (
        <div className="border-border/60 flex items-center gap-4 rounded-xl border bg-[hsl(var(--background))] p-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
          {avatarControl}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Change profile photo</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Supports JPG, PNG, and GIF (under 10MB)
            </p>
          </div>
        </div>
      )}

      {gifToCenter ? (
        <GifCenteringDialog
          currentValues={{ userId: user.id }}
          gifFile={gifToCenter}
          onClose={handleGifClose}
          target="avatar"
        />
      ) : null}

      {imageToCrop && cropUrl ? (
        <CropImageDialog
          cropAspectRatio={1}
          onClose={handleCropClose}
          onCropped={handleCropped}
          src={cropUrl}
        />
      ) : null}
    </>
  );
};
