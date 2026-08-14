"use client";

import type { PostData } from "@asm/db";
import { MessageSquare, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React from "react";

import Comments from "@/components/comments/comments";
import { formatNumber } from "@/lib/utils";

interface GustsCommentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  post: PostData;
}

export const GustsCommentsDrawer: React.FC<GustsCommentsDrawerProps> = ({
  isOpen,
  onClose,
  post,
}) => (
  <AnimatePresence>
    {isOpen ? (
      <>
        {/* Mobile backdrop */}
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Drawer Panel */}
        <motion.div
          animate={{ opacity: 1, x: 0, y: 0 }}
          className="border-border fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col rounded-t-3xl border-t bg-[hsl(var(--background-alt))] shadow-2xl md:static md:inset-auto md:h-full md:w-[380px] md:rounded-3xl md:border md:shadow-lg"
          exit={{ opacity: 0, y: "100%" }}
          initial={{ opacity: 0, y: "100%" }}
          transition={{ damping: 26, stiffness: 280, type: "spring" }}
        >
          {/* Header */}
          <div className="border-border/60 flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="text-primary size-4.5" />
              <h3 className="text-foreground text-sm font-bold">
                Eddies ({formatNumber(post._count.comments)})
              </h3>
            </div>
            <button
              aria-label="Close comments"
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full transition-colors"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Comments Stream & Input */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <Comments post={post} />
          </div>
        </motion.div>
      </>
    ) : null}
  </AnimatePresence>
);
