import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import "cropperjs/dist/cropper.css";
import { Crop, ImagePlus } from "lucide-react";
import { useCallback, useRef } from "react";
import { Cropper, type ReactCropperElement } from "react-cropper";
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
        className="apple-panel w-full max-w-120 gap-4 overflow-hidden p-0 sm:rounded-2xl"
        onClick={handleContentClick}
      >
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 font-semibold text-base">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                ORANGE_GRADIENT_CLASS
              )}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </div>
            Crop Image
          </DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground text-xs">
            Adjust your photo before saving
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <div className="overflow-hidden rounded-xl border border-border/60 bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
            <Cropper
              aspectRatio={cropAspectRatio}
              className="mx-auto size-fit"
              guides={false}
              ref={cropperRef}
              src={src}
              zoomable={false}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              className="pill-3d-hover h-10 w-full rounded-xl text-muted-foreground"
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
