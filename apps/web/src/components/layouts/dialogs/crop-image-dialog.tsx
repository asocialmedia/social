// oxlint-disable react/todo -- Async encoders retain the draft on failure using try/catch.
import { encodeAnimatedCrop } from "@asm/media/image-edit";
import { CROPPER_ACCENT } from "@asm/ui/lib/cropper-accent";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";

import "cropperjs/dist/cropper.css";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import { Crop, X, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";

import { cropHasTransparency } from "@/lib/media/crop-canvas";
import { cn } from "@/lib/utils";

const ORANGE_GRADIENT_CLASS =
  "orange-3d-surface bg-linear-to-b from-[#ff9500] to-[#e65500] text-white";

interface CropImageDialogProps {
  animated?: boolean;
  cropAspectRatio: number;
  onClose: () => void;
  onCropped: (blob: Blob | null) => void | Promise<void>;
  src: string;
}

export default function CropImageDialog({
  src,
  animated = false,
  cropAspectRatio,
  onCropped,
  onClose,
}: CropImageDialogProps) {
  const cropperRef = useRef<ReactCropperElement>(null);

  const [saving, setSaving] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  async function crop() {
    const cropper = cropperRef.current?.cropper;
    if (!cropper || saving) {
      return;
    }
    setSaving(true);
    setCropError(null);
    try {
      if (animated) {
        await onCropped(
          await encodeAnimatedCrop(
            src,
            cropper.getData(),
            cropAspectRatio === 1 ? 512 : 1500
          )
        );
      } else {
        const canvas = cropper.getCroppedCanvas();
        const type = cropHasTransparency(canvas) ? "image/png" : "image/jpeg";
        // oxlint-disable-next-line promise/avoid-new -- Canvas exposes a callback-based encoder.
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, type, 0.92);
        });
        if (!blob) {
          throw new Error("Couldn't encode that image");
        }
        await onCropped(blob);
      }
      onClose();
    } catch (error) {
      setCropError(
        error instanceof Error ? error.message : "Couldn't save that crop"
      );
    } finally {
      setSaving(false);
    }
  }

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent
        className="flex max-h-[75dvh] w-[calc(100%-2rem)] max-w-120 flex-col gap-4 overflow-hidden rounded-2xl! p-0 md:max-h-[85vh] [&>button:last-child]:hidden"
        onClick={handleContentClick}
      >
        {/* Header - matches EditProfile dialog */}
        <div className="border-border/60 flex shrink-0 items-center border-b py-2 pr-3 pl-3">
          <div className="relative size-10 shrink-0">
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="40px"
              src={avatarPlaceholder}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-2">
            <DialogTitle className="text-base font-semibold">
              {animated ? "Crop GIF" : "Crop Image"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-0.5 text-xs">
              {animated
                ? "Crop and position your GIF while keeping its animation"
                : "Adjust your photo before saving"}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="icon-btn-3d flex size-7 shrink-0 items-center justify-center rounded-full border-0"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
          {/* Custom cropper orange accent - uniform 10px dots centered on 2px border */}
          <style>{CROPPER_ACCENT}</style>
          {/* Cropper container - capped height so long photos never go out of screen */}
          <div className="border-border/60 flex h-[min(45dvh,380px)] shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] md:max-h-[50vh]">
            <Cropper
              aspectRatio={cropAspectRatio}
              className="asm-cropper h-full max-h-[45dvh] w-full max-w-full object-contain md:max-h-[50vh]"
              guides={false}
              ref={cropperRef}
              src={src}
              viewMode={1}
              zoomable
            />
          </div>

          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              aria-label="Zoom out"
              variant="outline"
              size="icon"
              disabled={saving}
              onClick={() => cropperRef.current?.cropper.zoom(-0.1)}
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              aria-label="Zoom in"
              variant="outline"
              size="icon"
              disabled={saving}
              onClick={() => cropperRef.current?.cropper.zoom(0.1)}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              aria-label="Rotate left"
              variant="outline"
              size="icon"
              disabled={saving}
              onClick={() => cropperRef.current?.cropper.rotate(-90)}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              aria-label="Rotate right"
              variant="outline"
              size="icon"
              disabled={saving}
              onClick={() => cropperRef.current?.cropper.rotate(90)}
            >
              <RotateCw className="size-4" />
            </Button>
          </div>
          {cropError ? (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {cropError}
            </p>
          ) : null}
          <div className="mt-4 grid shrink-0 grid-cols-2 gap-2">
            <Button
              className="pill-3d-hover text-muted-foreground h-10 w-full rounded-xl"
              onClick={onClose}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className={cn(
                "h-10 w-full rounded-xl",
                ORANGE_GRADIENT_CLASS,
                "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
              )}
              disabled={saving}
              onClick={() => {
                void crop();
              }}
            >
              <Crop className="h-4 w-4" />
              {saving ? "Processing…" : "Apply crop"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
