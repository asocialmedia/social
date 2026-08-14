"use client";

import { clientLog } from "@asm/config/debug";
import type { TagWithCount } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Hash, Plus } from "lucide-react";
import { easeInOut } from "motion";
import { AnimatePresence, motion } from "motion/react";
import type { Variants } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import { cn, formatNumber } from "@/lib/utils";

import { useUpdateTagsMutation } from "./mutations/tag-mention-mutation";
import { TagEditor } from "./tag-editor";

interface TagsProps {
  className?: string;
  isOwner?: boolean;
  onTagsChange?: (tags: TagWithCount[]) => void;
  postId?: string;
  tags: TagWithCount[];
}

const containerVariants = {
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      when: "beforeChildren",
    },
  },
  initial: { opacity: 0 },
};

const tagVariants: Variants = {
  animate: {
    opacity: 1,
    transition: {
      damping: 20,
      stiffness: 120,
      type: "spring",
    },
    y: 0,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: 0.15,
      ease: "easeOut",
    },
  },
  hover: {
    transition: {
      damping: 15,
      stiffness: 150,
      type: "spring",
    },
    y: -1,
  },
  initial: { opacity: 0, y: -3 },
};

const glowVariants = {
  animate: {
    filter: ["blur(6px)", "blur(10px)", "blur(6px)"],
    opacity: [0.25, 0.4, 0.25],
    scale: [0.95, 1.05, 0.95],
    transition: {
      duration: 2,
      ease: easeInOut,
      repeat: Number.POSITIVE_INFINITY,
    },
  },
  initial: { opacity: 0 },
};

const hashIconVariants = {
  hover: {
    opacity: 1,
    rotate: [0, -10, 0],
    scale: 1.2,
    transition: { duration: 0.3 },
  },
  initial: { opacity: 0.5, scale: 0.8 },
};

const baseTagClass =
  "flex items-center gap-1.5 rounded-full border px-3 py-1 shadow-xs h-7";

function getTagWidth(tag: TagWithCount) {
  const nameLength = tag.name.length;

  if (nameLength <= 5) {
    return "w-auto min-w-[70px]";
  }
  if (nameLength <= 10) {
    return "w-auto min-w-[90px]";
  }
  if (nameLength <= 15) {
    return "w-auto min-w-[110px]";
  }
  if (nameLength <= 20) {
    return "w-auto min-w-[130px]";
  }
  return "w-auto min-w-[150px]";
}

export const Tags = ({
  tags: initialTags,
  isOwner,
  className,
  postId,
  onTagsChange,
}: TagsProps) => {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [localTags, setLocalTags] = useState<TagWithCount[]>(initialTags);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const updateTags = useUpdateTagsMutation(postId);

  useEffect(() => {
    if (JSON.stringify(localTags) !== JSON.stringify(initialTags)) {
      // eslint-disable-next-line react-compiler -- sync external tag changes into local state
      setLocalTags(initialTags);
    }
  }, [initialTags, localTags]);

  const handleTagsUpdate = useCallback(
    async (updatedTags: TagWithCount[]) => {
      try {
        setLocalTags(updatedTags);
        setIsEditing(false);
        onTagsChange?.(updatedTags);

        if (postId) {
          await updateTags.mutateAsync(updatedTags.map((t) => t.name));
          queryClient.invalidateQueries({ queryKey: ["popularTags"] });
          queryClient.invalidateQueries({ queryKey: ["post", postId] });
        }
      } catch (error) {
        setLocalTags(initialTags);
        clientLog.error("Failed to update tags:", error);
      }
    },
    [postId, updateTags, queryClient, initialTags, onTagsChange]
  );

  const handleHoverEnd = useCallback(() => {
    setHoveredTag(null);
  }, []);

  const handleHoverStart = useCallback((e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement | null;
    const tagId = target?.dataset.tagId;
    if (tagId !== undefined) {
      setHoveredTag(tagId);
    }
  }, []);

  const handleEditClick = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleCloseEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Hash className="text-primary/70 h-3 w-3" />
          <span>Tags</span>
        </h3>
        <motion.div
          animate="animate"
          className={cn("flex flex-wrap gap-2", className)}
          initial="initial"
          variants={containerVariants}
        >
          <AnimatePresence mode="sync">
            {localTags.map((tag) => (
              <motion.div
                className="group relative cursor-pointer"
                data-tag-id={tag.id}
                key={tag.id}
                layout
                onHoverEnd={handleHoverEnd}
                onHoverStart={handleHoverStart}
                variants={tagVariants}
                whileHover="hover"
              >
                {hoveredTag === tag.id && (
                  <motion.div
                    animate="animate"
                    className="bg-primary/20 absolute inset-0 -z-10 rounded-full"
                    initial="initial"
                    variants={glowVariants}
                  />
                )}
                <div
                  className={cn(
                    baseTagClass,
                    getTagWidth(tag),
                    "border-primary/20 bg-primary/5 text-primary hover:border-primary/30 hover:bg-primary/10",
                    "backdrop-blur-xs backdrop-filter"
                  )}
                >
                  <motion.div
                    className="text-primary/70 flex items-center justify-center"
                    initial="initial"
                    variants={hashIconVariants}
                    whileHover="hover"
                  >
                    <Hash className="h-3.5 w-3.5" />
                  </motion.div>
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                    <span className="pointer-events-none inline-block truncate text-center font-medium">
                      {tag.name}
                    </span>

                    {tag._count?.posts !== undefined &&
                      tag._count.posts > 0 && (
                        <span className="bg-primary/10 text-primary/80 ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
                          {formatNumber(tag._count.posts)}
                        </span>
                      )}
                  </div>
                </div>
              </motion.div>
            ))}

            {isOwner ? (
              <motion.div
                className="relative"
                layout
                variants={tagVariants}
                whileHover="hover"
              >
                <Button
                  className={cn(
                    baseTagClass,
                    "border-primary/15 bg-primary/5 hover:border-primary/30 hover:bg-primary/10 h-7",
                    "font-normal"
                  )}
                  onClick={handleEditClick}
                  size="sm"
                  variant="outline"
                >
                  <Plus className="text-primary mr-1 h-3 w-3" />
                  <span className="text-primary text-xs">Add tag</span>
                </Button>
                <motion.div
                  className="bg-primary/20 absolute inset-0 -z-10 rounded-full blur-md"
                  initial={{ opacity: 0 }}
                  whileHover={{
                    opacity: 1,
                    transition: { duration: 0.2 },
                  }}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </div>

      <Dialog onOpenChange={setIsEditing} open={isEditing}>
        <DialogContent className="border-primary/15 shadow-primary/5 rounded-xl border shadow-lg sm:max-w-[400px]">
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <Hash className="text-primary h-3.5 w-3.5" />
            Edit Tags
          </DialogTitle>
          <DialogDescription
            aria-describedby="tag-editor"
            className="text-muted-foreground text-xs"
          >
            Edit tags for your post
          </DialogDescription>
          <TagEditor
            initialTags={localTags.map((t) => t.name)}
            onCloseAction={handleCloseEdit}
            onTagsUpdateAction={handleTagsUpdate}
            postId={postId}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
