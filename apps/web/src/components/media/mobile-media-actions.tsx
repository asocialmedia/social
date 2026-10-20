"use client";

import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const MOBILE_MEDIA_ICON =
  "relative size-8! text-white after:absolute after:-inset-1.5 after:content-[''] [&_svg]:size-4.5! [&_svg]:shrink-0";

export function MobileMediaActions({
  comments,
  onOpenEddies,
  vote,
  share,
  bookmark,
}: {
  comments: number;
  onOpenEddies: () => void;
  vote: ReactNode;
  share: ReactNode;
  bookmark: ReactNode;
}) {
  return (
    <div
      className="pointer-events-auto mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3"
      data-mobile-media-actions
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          aria-label="View eddies"
          className="media-viewer-chip flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 transition-all active:translate-y-px"
          onClick={onOpenEddies}
          type="button"
        >
          <MessageSquare
            className={cn("size-4.5", comments > 0 && "fill-current")}
          />
          <span className="text-sm leading-[18px] font-semibold tabular-nums">
            {comments}
          </span>
        </button>
        <div className="flex items-center gap-1.5 text-white [&_.text-muted-foreground]:text-white [&_button]:relative [&_button]:h-8! [&_button]:text-white [&_button]:after:absolute [&_button]:after:-inset-1.5 [&_button]:after:content-[''] [&_button:not([data-bluesky-like])]:w-8! [&_button[data-bluesky-like]]:min-w-8 [&_button[data-bluesky-like]]:px-0 [&_svg]:size-4.5! [&_svg]:shrink-0">
          {vote}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {share}
        {bookmark}
      </div>
    </div>
  );
}
