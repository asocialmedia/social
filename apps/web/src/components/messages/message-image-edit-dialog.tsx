"use client";

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
import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";

import { cropHasTransparency } from "@/lib/media/crop-canvas";
import { croppedImageFile } from "@/lib/media/cropped-image-file";
import { cn } from "@/lib/utils";

const ORANGE_GRADIENT_CLASS =
  "orange-3d-surface bg-linear-to-b from-[#ff9500] to-[#e65500] text-white";

const CROPPER_ACCENT = `
  .asm-message-cropper .cropper-view-box {
    outline: 2px solid #ff9500 !important;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22), 0 0 0 1px rgba(230,85,0,0.9) !important;
  }
  .asm-message-cropper .cropper-face { background-color: transparent !important; opacity: 1 !important; }
  .asm-message-cropper .cropper-modal { background-color: rgba(28,18,8,0.62) !important; opacity: 1 !important; }
  .asm-message-cropper .cropper-line { background-color: #ff9500 !important; opacity: 1 !important; }
  .asm-message-cropper .cropper-dashed { border-color: rgba(255,149,0,0.32) !important; opacity: 1 !important; }
  .asm-message-cropper .cropper-point {
    width: 10px !important; height: 10px !important;
    background-color: #fff !important; border: 2px solid #ff9500 !important;
    border-radius: 9999px !important; opacity: 1 !important;
  }
  .asm-message-cropper .cropper-center { display: none !important; }
`;

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
// rotation. GIFs are previewed but not re-encoded (a canvas crop would burn the
// animation to a single frame), mirroring the feed's GIF handling.
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

  const handleSave = useCallback(() => {
    if (kind === "gif") {
      onClose();
      return;
    }
    const cropper = cropperRef.current?.cropper;
    if (!cropper) {
      onClose();
      return;
    }
    const canvas = cropper.getCroppedCanvas();
    const type = cropHasTransparency(canvas) ? "image/png" : "image/jpeg";
    setSaving(true);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onSave(croppedImageFile(blob, baseNameFor(file.name)));
        }
        setSaving(false);
        onClose();
      },
      type,
      0.92
    );
  }, [file.name, kind, onClose, onSave]);

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-140 flex-col gap-4 overflow-hidden rounded-2xl p-0 [&>button:last-child]:hidden">
        <div className="border-border/60 flex shrink-0 items-center border-b py-2 pr-3 pl-4">
          <div className="flex min-w-0 flex-1 flex-col justify-center py-1">
            <DialogTitle className="text-base font-semibold">
              {kind === "gif" ? "GIF Preview" : "Edit Image"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-0.5 text-xs">
              {kind === "gif"
                ? "GIFs can't be cropped without losing their animation"
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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5">
          <div className="border-border/60 flex min-h-0 items-center justify-center overflow-hidden rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
            {kind === "gif" ? (
              <Image
                alt="GIF preview"
                className="max-h-[50dvh] w-auto object-contain"
                height={480}
                src={objectUrl}
                unoptimized
                width={480}
              />
            ) : (
              <>
                <style>{CROPPER_ACCENT}</style>
                <Cropper
                  className="asm-message-cropper max-h-[50dvh] w-full object-contain"
                  guides={false}
                  ref={cropperRef}
                  src={objectUrl}
                  viewMode={1}
                />
              </>
            )}
          </div>

          {kind === "gif" ? null : (
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
          )}

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
              onClick={handleSave}
            >
              {kind === "gif" ? "Done" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
