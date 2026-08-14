import { Dialog, DialogContent } from "@asm/ui/shadui/dialog";

import { cn } from "@/lib/utils";

interface MediaViewerSkeletonProps {
  className?: string;
  type?: "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DOCUMENT";
}

export const MediaViewerSkeleton = ({
  type = "IMAGE",
  className,
}: MediaViewerSkeletonProps) => {
  const renderSkeletonContent = () => {
    switch (type) {
      case "IMAGE":
      case "VIDEO": {
        return (
          <div className="relative max-h-[85vh] min-h-[50vh] w-full max-w-4xl animate-pulse">
            <div className="animate-shimmer from-muted/50 via-muted to-muted/50 h-full w-full rounded-lg bg-gradient-to-r bg-[length:200%_100%]" />
          </div>
        );
      }

      case "AUDIO": {
        return (
          <div className="bg-background/50 flex animate-pulse flex-col items-center gap-4 rounded-lg p-8">
            <div className="bg-muted/50 flex h-64 w-64 items-center justify-center rounded-full">
              <div className="bg-muted h-32 w-32 animate-pulse rounded-full" />
            </div>
            <div className="bg-muted h-6 w-48 rounded-full" />
            <div className="bg-muted h-12 w-full max-w-md rounded-lg" />
          </div>
        );
      }

      case "CODE": {
        return (
          <div className="bg-background/50 w-full max-w-4xl animate-pulse rounded-lg p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="space-y-2">
                <div className="bg-muted h-5 w-48 rounded-full" />
                <div className="bg-muted/80 h-4 w-24 rounded-full" />
              </div>
              <div className="bg-muted h-9 w-24 rounded-md" />
            </div>
            <div className="bg-muted/30 space-y-2 rounded-lg p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  className="bg-muted/50 h-4 w-full rounded-sm"
                  key={i}
                  style={{ width: `${Math.random() * 40 + 60}%` }}
                />
              ))}
            </div>
          </div>
        );
      }

      case "DOCUMENT": {
        return (
          <div className="bg-background/50 flex animate-pulse flex-col items-center gap-4 rounded-lg p-8">
            <div className="bg-muted/50 flex h-32 w-32 items-center justify-center rounded-full">
              <div className="bg-muted h-16 w-16 animate-pulse rounded-lg" />
            </div>
            <div className="bg-muted h-5 w-48 rounded-full" />
            <div className="bg-muted/80 h-4 w-32 rounded-full" />
            <div className="flex gap-4">
              <div className="bg-muted h-9 w-24 rounded-md" />
              <div className="bg-muted/80 h-9 w-24 rounded-md" />
            </div>
          </div>
        );
      }

      default: {
        return null;
      }
    }
  };

  return (
    <Dialog open>
      <DialogContent
        className={cn(
          "max-h-[95vh] max-w-[95vw] border-none bg-transparent p-0",
          className
        )}
      >
        <div className="relative flex h-full min-h-[50vh] w-full items-center justify-center">
          <div className="bg-background/80 absolute inset-0 backdrop-blur-xl" />

          <div className="bg-muted/50 absolute top-2 right-2 z-50 h-9 w-9 animate-pulse rounded-md" />
          <div className="bg-muted/50 absolute top-1/2 left-2 z-50 h-9 w-9 -translate-y-1/2 animate-pulse rounded-md" />
          <div className="bg-muted/50 absolute top-1/2 right-2 z-50 h-9 w-9 -translate-y-1/2 animate-pulse rounded-md" />

          <div className="bg-muted/50 absolute bottom-4 left-1/2 z-50 h-6 w-16 -translate-x-1/2 animate-pulse rounded-full" />

          <div className="relative flex h-full w-full items-center justify-center p-4">
            {renderSkeletonContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
