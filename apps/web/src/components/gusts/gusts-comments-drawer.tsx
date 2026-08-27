"use client";

import type { PostData } from "@asm/db";
import { X } from "lucide-react";
import React from "react";

import Comments from "@/components/comments/comments";

interface GustsCommentsDrawerProps {
  onClose: () => void;
  post: PostData;
}

// Pure comments panel: a slim close row on top and the full eddie stream below.
// Enter/exit motion is handled by the parent so it can differ per breakpoint
// (desktop slides in from the right, mobile sheets up from the bottom).
export const GustsCommentsDrawer: React.FC<GustsCommentsDrawerProps> = ({
  onClose,
  post,
}) => (
  <div className="flex h-full w-full flex-col overflow-hidden">
    {/* Slim close row (no thick header) */}
    <div className="flex shrink-0 items-center justify-end px-3 pt-2 pb-1">
      <button
        aria-label="Close comments"
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full transition-colors"
        onClick={onClose}
        type="button"
      >
        <X className="size-4" />
      </button>
    </div>

    {/* Eddie stream + input */}
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [&_form]:mt-0 [&_form]:mb-3">
      <Comments post={post} reels />
    </div>
  </div>
);
