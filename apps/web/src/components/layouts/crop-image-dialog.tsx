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
import { Crop, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useRef } from "react";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";

import { cn } from "@/lib/utils";

const ORANGE_GRADIENT_CLASS =
  "bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface CropImageDialogProps {
  cropAspectRatio: number;
  onClose: () => void;
  onCropped: (blob: Blob | null) => void;
  src: string;
}

export default function CropImageDialog({
  src,
  cropAspectRatio,
  onCropped,
  onClose,
}: CropImageDialogProps) {
  const cropperRef = useRef<ReactCropperElement>(null);

  function crop() {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) {
      return;
    }
    cropper.getCroppedCanvas().toBlob((blob) => onCropped(blob), "image/webp");
    onClose();
  }

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent
        className="apple-panel flex max-h-[75dvh] w-[calc(100%-1.5rem)] max-w-120 flex-col gap-4 overflow-hidden rounded-2xl border-0 p-0 md:max-h-[85vh] [&>button:last-child]:hidden"
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
              Crop Image
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-0.5 text-xs">
              Adjust your photo before saving
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
          {/* Custom cropper orange accent - uniform 10px dots centered on 2px border */}
          <style>{`
            .asm-cropper .cropper-view-box {
              outline: 2px solid #ff9500 !important;
              outline-color: #ff9500 !important;
              box-shadow:
                inset 0 0 0 1px rgba(255,255,255,0.22),
                0 0 0 1px rgba(230,85,0,0.9),
                0 2px 8px rgba(0,0,0,0.18) !important;
            }
            .asm-cropper .cropper-face {
              background-color: transparent !important;
              opacity: 1 !important;
            }
            .asm-cropper .cropper-modal {
              background-color: rgba(28, 18, 8, 0.62) !important;
              opacity: 1 !important;
            }
            .asm-cropper .cropper-line {
              background-color: #ff9500 !important;
              opacity: 1 !important;
            }
            .asm-cropper .cropper-line.line-n {
              top: 0 !important;
              left: 0 !important;
              width: 100% !important;
              height: 2px !important;
            }
            .asm-cropper .cropper-line.line-s {
              bottom: 0 !important;
              left: 0 !important;
              width: 100% !important;
              height: 2px !important;
              top: auto !important;
            }
            .asm-cropper .cropper-line.line-e {
              top: 0 !important;
              right: 0 !important;
              height: 100% !important;
              width: 2px !important;
              left: auto !important;
            }
            .asm-cropper .cropper-line.line-w {
              top: 0 !important;
              left: 0 !important;
              height: 100% !important;
              width: 2px !important;
              right: auto !important;
            }
            /* All 8 handles identical - 10px white / orange, centered on border */
            .asm-cropper .cropper-point {
              width: 10px !important;
              height: 10px !important;
              background-color: #fff !important;
              border: 2px solid #ff9500 !important;
              border-radius: 9999px !important;
              box-shadow:
                inset 0 1px 1px rgba(255,255,255,0.95),
                0 1px 4px rgba(0,0,0,0.28) !important;
              opacity: 1 !important;
            }
            .asm-cropper .cropper-point.point-n {
              top: 0 !important;
              left: 50% !important;
              right: auto !important;
              bottom: auto !important;
              margin-left: -5px !important;
              margin-top: -5px !important;
            }
            .asm-cropper .cropper-point.point-s {
              bottom: 0 !important;
              left: 50% !important;
              top: auto !important;
              right: auto !important;
              margin-left: -5px !important;
              margin-bottom: -5px !important;
              margin-top: 0 !important;
            }
            .asm-cropper .cropper-point.point-e {
              top: 50% !important;
              right: 0 !important;
              left: auto !important;
              bottom: auto !important;
              margin-top: -5px !important;
              margin-right: -5px !important;
            }
            .asm-cropper .cropper-point.point-w {
              top: 50% !important;
              left: 0 !important;
              right: auto !important;
              bottom: auto !important;
              margin-top: -5px !important;
              margin-left: -5px !important;
            }
            .asm-cropper .cropper-point.point-ne {
              top: 0 !important;
              right: 0 !important;
              left: auto !important;
              bottom: auto !important;
              margin-top: -5px !important;
              margin-right: -5px !important;
              margin-left: 0 !important;
            }
            .asm-cropper .cropper-point.point-nw {
              top: 0 !important;
              left: 0 !important;
              right: auto !important;
              bottom: auto !important;
              margin-top: -5px !important;
              margin-left: -5px !important;
            }
            .asm-cropper .cropper-point.point-se {
              bottom: 0 !important;
              right: 0 !important;
              left: auto !important;
              top: auto !important;
              margin-bottom: -5px !important;
              margin-right: -5px !important;
              margin-top: 0 !important;
              margin-left: 0 !important;
              width: 10px !important;
              height: 10px !important;
              opacity: 1 !important;
            }
            .asm-cropper .cropper-point.point-sw {
              bottom: 0 !important;
              left: 0 !important;
              right: auto !important;
              top: auto !important;
              margin-bottom: -5px !important;
              margin-left: -5px !important;
              margin-top: 0 !important;
            }
            /* Kill responsive size jumps for point-se */
            @media (min-width: 768px) {
              .asm-cropper .cropper-point.point-se {
                width: 10px !important;
                height: 10px !important;
              }
            }
            @media (min-width: 992px) {
              .asm-cropper .cropper-point.point-se {
                width: 10px !important;
                height: 10px !important;
              }
            }
            @media (min-width: 1200px) {
              .asm-cropper .cropper-point.point-se {
                width: 10px !important;
                height: 10px !important;
                opacity: 1 !important;
              }
            }
            .asm-cropper .cropper-point.point-se::before {
              display: none !important;
            }
            .asm-cropper .cropper-center {
              display: none !important;
            }
            .asm-cropper .cropper-dashed {
              border-color: rgba(255,149,0,0.32) !important;
              opacity: 1 !important;
            }
          `}</style>
          {/* Cropper container - capped height so long photos never go out of screen */}
          <div className="border-border/60 flex max-h-[45dvh] min-h-0 items-center justify-center overflow-hidden rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] md:max-h-[50vh]">
            <Cropper
              aspectRatio={cropAspectRatio}
              className="asm-cropper h-full max-h-[45dvh] w-full max-w-full object-contain md:max-h-[50vh]"
              guides={false}
              ref={cropperRef}
              src={src}
              zoomable={false}
            />
          </div>

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
              onClick={crop}
            >
              <Crop className="h-4 w-4" />
              Crop
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
