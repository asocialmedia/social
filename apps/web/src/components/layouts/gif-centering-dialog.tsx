import { clientLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useUpdateAvatarMutation,
  useUpdateBannerMutation,
} from "@/app/(main)/users/[username]/avatar-mutations";
import { LoadingButton } from "@/components/auth/loading-button";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface GifCenteringDialogProps {
  currentValues: {
    userId: string;
  };
  gifFile: File;
  onClose: () => void;
  /** Which profile surface the GIF is for; picks the linking mutation. */
  target: "avatar" | "banner";
}

export default function GifCenteringDialog({
  gifFile,
  onClose,
  currentValues,
  target,
}: GifCenteringDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gifRef = useRef<HTMLImageElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const previewUrl = useMemo(() => URL.createObjectURL(gifFile), [gifFile]);

  useEffect(
    () => () => {
      URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  // Hooks can't be conditional; call both and pick by target.
  const avatarMutation = useUpdateAvatarMutation();
  const bannerMutation = useUpdateBannerMutation();
  const mutation = target === "banner" ? bannerMutation : avatarMutation;
  const { toast } = useToast();

  const MoveAmount = 10;
  const ZoomStep = 0.1;
  const MinZoom = 0.5;
  const MaxZoom = 2;

  const handleMove = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      setPosition((prev) => {
        switch (direction) {
          case "up": {
            return { ...prev, y: prev.y + MoveAmount };
          }
          case "down": {
            return { ...prev, y: prev.y - MoveAmount };
          }
          case "left": {
            return { ...prev, x: prev.x + MoveAmount };
          }
          case "right": {
            return { ...prev, x: prev.x - MoveAmount };
          }
          default: {
            return prev;
          }
        }
      });
    },
    []
  );

  const handleZoom = useCallback((increase: boolean) => {
    setZoom((prev) => {
      const newZoom = increase ? prev + ZoomStep : prev - ZoomStep;
      return Math.min(Math.max(newZoom, MinZoom), MaxZoom);
    });
  }, []);

  const handleMoveUp = useCallback(() => handleMove("up"), [handleMove]);
  const handleMoveLeft = useCallback(() => handleMove("left"), [handleMove]);
  const handleMoveRight = useCallback(() => handleMove("right"), [handleMove]);
  const handleMoveDown = useCallback(() => handleMove("down"), [handleMove]);
  const handleZoomIn = useCallback(() => handleZoom(true), [handleZoom]);
  const handleZoomOut = useCallback(() => handleZoom(false), [handleZoom]);

  const handleComplete = async () => {
    try {
      const timestamp = Date.now();
      const safePosition = {
        x: Math.round(position.x * 100) / 100,
        y: Math.round(position.y * 100) / 100,
        z: Math.round(zoom * 100) / 100,
      };

      const transformedFileName = `${target}_${timestamp}_x${safePosition.x}_y${safePosition.y}_z${safePosition.z}.gif`;

      const file = new File([gifFile], transformedFileName, {
        type: "image/gif",
      });

      await mutation.mutateAsync({
        file,
        userId: currentValues.userId,
      });

      onClose();
      toast({
        description:
          target === "banner"
            ? "Nice! Your new header is live!"
            : "Nice! Your new avatar is live!",
        title:
          target === "banner" ? "Header Updated" : "Profile Picture Updated",
      });
    } catch (error) {
      clientLog.error("Error processing GIF:", error);
      toast({
        description:
          target === "banner"
            ? "Couldn't set that header, try again?"
            : "Couldn't set that avatar, try again?",
        title: "Couldn't Update",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Center Your GIF</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className={cn(
              "border-border bg-secondary relative overflow-hidden border-2",
              target === "banner"
                ? "aspect-[3/1] w-full max-w-80"
                : "size-64 rounded-full"
            )}
            ref={containerRef}
          >
            <motion.div
              animate={{
                scale: zoom,
                x: position.x,
                y: position.y,
              }}
              className="absolute inset-0 flex items-center justify-center"
              transition={{ damping: 30, stiffness: 300, type: "spring" }}
            >
              <Image
                alt={target === "banner" ? "Header GIF preview" : "GIF preview"}
                className="size-full"
                draggable={false}
                fill
                ref={gifRef}
                sizes={target === "banner" ? "320px" : "256px"}
                src={previewUrl}
                style={{
                  objectFit: "contain",
                  transformOrigin: "center",
                }}
                unoptimized
              />
            </motion.div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              <div />
              <Button
                disabled={mutation.isPending}
                onClick={handleMoveUp}
                size="icon"
                variant="outline"
              >
                <ChevronUp className="size-4" />
              </Button>
              <div />

              <Button
                disabled={mutation.isPending}
                onClick={handleMoveLeft}
                size="icon"
                variant="outline"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="flex items-center justify-center">
                <span className="text-muted-foreground text-sm">Move</span>
              </div>
              <Button
                disabled={mutation.isPending}
                onClick={handleMoveRight}
                size="icon"
                variant="outline"
              >
                <ChevronRight className="size-4" />
              </Button>

              <div />
              <Button
                disabled={mutation.isPending}
                onClick={handleMoveDown}
                size="icon"
                variant="outline"
              >
                <ChevronDown className="size-4" />
              </Button>
              <div />
            </div>

            <div className="flex items-center justify-center gap-2">
              <Button
                disabled={zoom <= MinZoom || mutation.isPending}
                onClick={handleZoomOut}
                size="icon"
                variant="outline"
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="min-w-12 text-center text-sm">
                {(zoom * 100).toFixed(0)}%
              </span>
              <Button
                disabled={zoom >= MaxZoom || mutation.isPending}
                onClick={handleZoomIn}
                size="icon"
                variant="outline"
              >
                <ZoomIn className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={mutation.isPending}
            onClick={onClose}
            variant="ghost"
          >
            Cancel
          </Button>
          <LoadingButton loading={mutation.isPending} onClick={handleComplete}>
            Apply Changes
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
