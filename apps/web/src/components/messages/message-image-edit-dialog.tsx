// oxlint-disable react/todo -- Async encoders retain the draft on failure using try/catch.
"use client";

import { encodeAnimatedCrop } from "@asm/media/image-edit";
import { PhotoEditorWorkspace } from "@asm/ui/components/photo-editor-workspace";
import type { PhotoEditorHandle } from "@asm/ui/components/photo-editor-workspace";
import { CROPPER_ACCENT } from "@asm/ui/lib/cropper-accent";
import {
  applyPhotoCropAction,
  capturePhotoSnapshot,
  restorePhotoCrop,
} from "@asm/ui/lib/photo-editing";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Switch } from "@asm/ui/shadui/switch";

import "cropperjs/dist/cropper.css";
import "@asm/ui/styles/photo-editor.css";
import { Eye, RotateCcw, RotateCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  onSave: (file: File, viewOnce: boolean) => void;
  viewOnce?: boolean;
  canViewOnce?: boolean;
}

// Edits stay local until saved; animated crops preserve each frame and its timing.
export default function MessageImageEditDialog({
  file,
  kind,
  objectUrl,
  onClose,
  onSave,
  viewOnce: initialViewOnce = false,
  canViewOnce = false,
}: MessageImageEditDialogProps) {
  const cropperRef = useRef<ReactCropperElement>(null);
  const editorRef = useRef<PhotoEditorHandle>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const viewOnceId = useId();
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [viewOnce, setViewOnce] = useState(initialViewOnce);

  useLayoutEffect(() => {
    let frame: number | null = null;
    let sourceCrop: ReturnType<
      ReactCropperElement["cropper"]["getData"]
    > | null = null;
    // Capture source coordinates before Cropper scales its canvas on resize.
    const preserveCrop = () => {
      const cropper = cropperRef.current?.cropper;
      if (!cropper) {
        return;
      }
      sourceCrop ??= cropper.getData();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        const selection = sourceCrop;
        sourceCrop = null;
        if (selection && selection.width > 0 && selection.height > 0) {
          restorePhotoCrop(cropperRef.current?.cropper, selection);
        }
      });
    };
    window.addEventListener("resize", preserveCrop, true);
    return () => {
      window.removeEventListener("resize", preserveCrop, true);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const rotate = useCallback((degrees: number) => {
    cropperRef.current?.cropper.rotate(degrees);
  }, []);

  const [cropError, setCropError] = useState<string | null>(null);
  const handleSave = useCallback(async () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper || saving || !ready) {
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
        const canvas = editorRef.current?.exportCanvas();
        if (!canvas) {
          throw new Error("Wait for your photo to load");
        }
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
      if (mounted.current) {
        onSave(result, viewOnce);
        onClose();
      }
    } catch (error) {
      if (mounted.current) {
        setCropError(
          error instanceof Error ? error.message : "Couldn't save that crop"
        );
      }
    } finally {
      if (mounted.current) {
        setSaving(false);
      }
    }
  }, [file.name, kind, objectUrl, onClose, onSave, ready, saving, viewOnce]);

  const getSnapshot = useCallback(
    () => capturePhotoSnapshot(cropperRef.current?.cropper),
    []
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-160 flex-col gap-0 overflow-hidden rounded-2xl! p-0 sm:max-h-[92dvh] sm:w-[calc(100%-2rem)]"
        showCloseButton={false}
      >
        <div className="border-border/60 flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-col justify-center py-1">
            <DialogTitle className="text-base font-semibold">
              {kind === "gif" ? "Edit GIF" : "Edit Image"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {kind === "gif"
                ? "Crop and rotate while keeping the animation"
                : "Edit your photo before sending"}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            disabled={saving}
            className="icon-btn-3d flex size-11 shrink-0 items-center justify-center rounded-full border-0"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3">
          <style>{CROPPER_ACCENT}</style>
          {kind === "image" ? (
            <PhotoEditorWorkspace
              ref={editorRef}
              ready={ready}
              disabled={saving}
              getSnapshot={getSnapshot}
              onCropAction={(action) =>
                applyPhotoCropAction(cropperRef.current?.cropper, action)
              }
              onError={setCropError}
              cropContent={
                <Cropper
                  autoCropArea={1}
                  className="asm-message-cropper h-full w-full"
                  guides={false}
                  ref={cropperRef}
                  src={objectUrl}
                  viewMode={1}
                  ready={() => setReady(true)}
                />
              }
            />
          ) : (
            <div className="border-border/60 flex h-[min(50dvh,420px)] shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[hsl(var(--background))]">
              <Cropper
                autoCropArea={1}
                className="asm-message-cropper h-full w-full object-contain"
                guides={false}
                ref={cropperRef}
                src={objectUrl}
                viewMode={1}
                ready={() => setReady(true)}
              />
            </div>
          )}

          {kind === "gif" ? (
            <div className="flex items-center gap-2">
              <Button
                aria-label="Rotate left"
                className="rounded-xl"
                onClick={() => rotate(-90)}
                type="button"
                variant="outline"
                disabled={saving || !ready}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                aria-label="Rotate right"
                className="rounded-xl"
                onClick={() => rotate(90)}
                type="button"
                variant="outline"
                disabled={saving || !ready}
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {cropError ? (
            <p role="alert" className="text-destructive text-sm">
              {cropError}
            </p>
          ) : null}
        </div>
        <div className="border-border/50 bg-background/95 grid w-full min-w-0 shrink-0 justify-items-stretch gap-2.5 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {kind === "image" ? (
            <div
              className="surface-3d text-muted-foreground grid min-h-13.5 w-full min-w-0 grid-cols-[minmax(0,1fr)_44px] items-center rounded-[14px]! p-1 text-sm"
              title={
                canViewOnce
                  ? "Opens once, then disappears"
                  : "Available for one photo without a caption"
              }
            >
              <label
                htmlFor={viewOnceId}
                className={cn(
                  "grid min-h-11 min-w-0 cursor-pointer grid-cols-[44px_minmax(0,1fr)] items-center gap-2 pr-2 font-medium",
                  (!canViewOnce || saving) && "cursor-default opacity-50"
                )}
              >
                <Eye className="size-4 shrink-0 justify-self-center" />
                <span>View once</span>
              </label>
              <div className="flex size-11 items-center justify-center">
                <Switch
                  id={viewOnceId}
                  aria-label="Send as a view once photo"
                  checked={viewOnce}
                  disabled={!canViewOnce || saving}
                  onCheckedChange={setViewOnce}
                />
              </div>
            </div>
          ) : null}
          <div className="grid w-full min-w-0 grid-cols-2 gap-2">
            <Button
              className="pill-3d-hover text-muted-foreground h-11 w-full rounded-xl"
              onClick={onClose}
              variant="outline"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                "h-11 w-full rounded-xl",
                ORANGE_GRADIENT_CLASS,
                "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
              )}
              disabled={saving || !ready}
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
