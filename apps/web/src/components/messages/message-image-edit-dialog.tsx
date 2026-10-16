// oxlint-disable react/todo -- Async encoders retain the draft on failure using try/catch.
"use client";

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
import { RotateCcw, RotateCw, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";

import { cropHasTransparency } from "@/lib/media/crop-canvas";
import { croppedImageFile } from "@/lib/media/cropped-image-file";
import { cn } from "@/lib/utils";

const ORANGE_GRADIENT_CLASS =
  "orange-3d-surface bg-linear-to-b from-[#ff9500] to-[#e65500] text-white";

// Derives a stable base filename for the re-encoded crop so the pipeline sees a
// sensible object name.
function baseNameFor(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "");
  return withoutExtension.length > 0 ? withoutExtension : "image";
}

interface MessageImageEditDialogProps {
  file: File;
  kind: "gif" | "image";
  objectUrl: string;
  onClose: () => void;
  onSave: (file: File) => void;
}

// Pre-send editor for a staged message image: free crop plus 90-degree
// rotation. Animated crops preserve each frame and its timing.
export default function MessageImageEditDialog({
  file,
  kind,
  objectUrl,
  onClose,
  onSave,
}: MessageImageEditDialogProps) {
  const cropperRef = useRef<ReactCropperElement>(null);
  const [saving, setSaving] = useState(false);

  const rotate = useCallback((degrees: number) => {
    cropperRef.current?.cropper.rotate(degrees);
  }, []);

  const [cropError, setCropError] = useState<string | null>(null);
  const handleSave = useCallback(async () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper || saving) {
      return;
    }
    setSaving(true);
    setCropError(null);
    try {
      let result: File;
      if (kind === "gif") {
        const blob = await encodeAnimatedCrop(objectUrl, cropper.getData());
        result = new File(
          [blob],
          `${baseNameFor(file.name)}-edited-${Date.now()}.gif`,
          { type: "image/gif" }
        );
      } else {
        const canvas = cropper.getCroppedCanvas({
          maxHeight: 2000,
          maxWidth: 2000,
        });
        const type = cropHasTransparency(canvas) ? "image/png" : "image/jpeg";
        // oxlint-disable-next-line promise/avoid-new -- Canvas uses a callback encoder.
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, type, 0.92);
        });
        if (!blob) {
          throw new Error("Couldn't encode that image");
        }
        result = croppedImageFile(
          blob,
          `${baseNameFor(file.name)}-edited-${Date.now()}`
        );
      }
      onSave(result);
      onClose();
    } catch (error) {
      setCropError(
        error instanceof Error ? error.message : "Couldn't save that crop"
      );
    } finally {
      setSaving(false);
    }
  }, [file.name, kind, objectUrl, onClose, onSave, saving]);

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-140 flex-col gap-4 overflow-hidden rounded-2xl! p-0 [&>button:last-child]:hidden">
        <div className="border-border/60 flex shrink-0 items-center border-b py-2 pr-3 pl-4">
          <div className="flex min-w-0 flex-1 flex-col justify-center py-1">
            <DialogTitle className="text-base font-semibold">
              {kind === "gif" ? "Edit GIF" : "Edit Image"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-0.5 text-xs">
              {kind === "gif"
                ? "Crop and rotate while keeping the animation"
                : "Crop and rotate before sending"}
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
          <div className="border-border/60 flex h-[min(50dvh,420px)] shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
            <style>{CROPPER_ACCENT}</style>
            <Cropper
              className="asm-message-cropper h-full w-full object-contain"
              guides={false}
              ref={cropperRef}
              src={objectUrl}
              viewMode={1}
            />
          </div>

          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              aria-label="Rotate left"
              className="rounded-xl"
              onClick={() => rotate(-90)}
              type="button"
              variant="outline"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Rotate right"
              className="rounded-xl"
              onClick={() => rotate(90)}
              type="button"
              variant="outline"
            >
              <RotateCw className="h-4 w-4" />
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
                void handleSave();
              }}
            >
              {saving ? "Processing…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
