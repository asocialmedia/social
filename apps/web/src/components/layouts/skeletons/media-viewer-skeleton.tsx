import type React from "react";

import { cn } from "@/lib/utils";

interface MediaViewerSkeletonProps {
  className?: string;
  type?: "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DOCUMENT";
}

export const MediaViewerSkeleton: React.FC<MediaViewerSkeletonProps> = ({
  type = "IMAGE",
  className,
}) => {
  if (type === "AUDIO") {
    return (
      <div
        className={cn(
          "bg-muted/10 border-border/40 flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border p-8 backdrop-blur-md",
          className
        )}
      >
        <div className="bg-muted/40 flex h-32 w-32 animate-pulse items-center justify-center rounded-full" />
        <div className="bg-muted/40 h-5 w-44 animate-pulse rounded-full" />
        <div className="bg-muted/30 h-10 w-full animate-pulse rounded-xl" />
      </div>
    );
  }

  if (type === "CODE") {
    return (
      <div
        className={cn(
          "bg-muted/10 border-border/40 w-full max-w-3xl rounded-2xl border p-5 backdrop-blur-md",
          className
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="space-y-2">
            <div className="bg-muted/40 h-4 w-40 animate-pulse rounded-full" />
            <div className="bg-muted/30 h-3 w-20 animate-pulse rounded-full" />
          </div>
          <div className="bg-muted/30 h-8 w-20 animate-pulse rounded-lg" />
        </div>
        <div className="space-y-2.5 pt-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              className="bg-muted/30 h-3.5 animate-pulse rounded-md"
              key={i}
              style={{ width: `${60 + ((i * 17) % 35)}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (type === "DOCUMENT") {
    return (
      <div
        className={cn(
          "bg-muted/10 border-border/40 flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border p-8 backdrop-blur-md",
          className
        )}
      >
        <div className="bg-muted/40 flex h-24 w-24 animate-pulse items-center justify-center rounded-2xl" />
        <div className="bg-muted/40 h-4 w-40 animate-pulse rounded-full" />
        <div className="bg-muted/30 h-3 w-28 animate-pulse rounded-full" />
      </div>
    );
  }

  // IMAGE / VIDEO: a full-bleed placeholder that fills the entire media area and
  // is centered with the media (never a small left-aligned box). The content
  // renders over it, so it mirrors the actual viewing region.
  return (
    <div
      className={cn(
        "relative h-full max-h-full w-full max-w-full overflow-hidden",
        className
      )}
    >
      <div className="bg-muted/15 absolute inset-0 animate-pulse" aria-hidden />
    </div>
  );
};
