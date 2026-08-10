"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { AtSign, Sparkles } from "lucide-react";
import { easeInOut } from "motion";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn } from "@/lib/utils";
import { useUpdateMentionsMutation } from "@/posts/editor/mutations";
import { MentionTagEditor } from "./mention-tag-editor";

const containerVariants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      when: "beforeChildren",
    },
  },
};

const tagVariants: Variants = {
  initial: { opacity: 0, y: -3 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 120,
      damping: 20,
    },
  },
  hover: {
    y: -1,
    transition: {
      type: "spring",
      stiffness: 150,
      damping: 15,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: 0.15,
      ease: "easeOut",
    },
  },
};

const glowVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: [0.25, 0.4, 0.25],
    scale: [0.95, 1.05, 0.95],
    filter: ["blur(6px)", "blur(10px)", "blur(6px)"],
    transition: {
      duration: 2,
      repeat: Number.POSITIVE_INFINITY,
      ease: easeInOut,
    },
  },
};

const baseTagClass =
  "flex items-center gap-1.5 rounded-full border px-3 py-1 shadow-xs h-7";

interface MentionTagsProps {
  className?: string;
  isOwner: boolean;
  mentions: UserData[];
  onMentionsChange?: (mentions: UserData[]) => void;
  postId?: string;
}

export function MentionTags({
  mentions: initialMentions,
  isOwner,
  className,
  postId,
  onMentionsChange,
}: MentionTagsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localMentions, setLocalMentions] =
    useState<UserData[]>(initialMentions);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const updateMentions = useUpdateMentionsMutation(postId);

  useEffect(() => {
    if (JSON.stringify(localMentions) !== JSON.stringify(initialMentions)) {
      setLocalMentions(initialMentions);
    }
  }, [initialMentions, localMentions]);

  const handleMentionsUpdate = async (newMentions: UserData[]) => {
    try {
      setLocalMentions(newMentions);
      setIsEditing(false);

      if (postId) {
        await updateMentions.mutateAsync(newMentions.map((m) => m.id));
      }
      onMentionsChange?.(newMentions);
    } catch (error) {
      setLocalMentions(initialMentions);
      console.error("Failed to update mentions:", error);
    }
  };

  const getTagWidth = (user: UserData) => {
    const displayName = user.displayName || user.username;
    const username = user.username;
    const displayNameLength = displayName.length;
    const usernameLength = username.length;
    const maxLength = Math.max(displayNameLength, usernameLength);

    if (maxLength <= 10) {
      return "w-auto min-w-[80px]";
    }
    if (maxLength <= 15) {
      return "w-auto min-w-[100px]";
    }
    if (maxLength <= 20) {
      return "w-auto min-w-[120px]";
    }
    return "w-auto min-w-[140px]";
  };

  return (
    <>
      {localMentions.length > 0 || isOwner ? (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Sparkles className="h-3 w-3 text-blue-400" />
            <span>Mentioned in post</span>
          </h3>
          <motion.div
            animate="animate"
            className={cn("flex flex-wrap gap-2", className)}
            initial="initial"
            variants={containerVariants}
          >
            <AnimatePresence mode="sync">
              {localMentions.map((user) => (
                <Link
                  className="rounded-full no-underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  href={`/users/${user.username}`}
                  key={user.id}
                >
                  <motion.div
                    className="group relative cursor-pointer"
                    layout
                    onHoverEnd={() => setHoveredTag(null)}
                    onHoverStart={() => setHoveredTag(user.id)}
                    variants={tagVariants}
                    whileHover="hover"
                  >
                    {hoveredTag === user.id && (
                      <motion.div
                        animate="animate"
                        className="absolute inset-0 -z-10 rounded-full bg-blue-500/20"
                        initial="initial"
                        variants={glowVariants}
                      />
                    )}
                    <div
                      className={cn(
                        baseTagClass,
                        getTagWidth(user),
                        "border-blue-400/20 bg-blue-500/5 text-blue-600 hover:border-blue-500/30 hover:bg-blue-500/10",
                        "backdrop-blur-xs backdrop-filter"
                      )}
                    >
                      <UserAvatar size={20} user={user} />
                      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                        <motion.span
                          animate={{
                            opacity: hoveredTag === user.id ? 0 : 1,
                            y: hoveredTag === user.id ? -8 : 0,
                            transition: { duration: 0.15 },
                          }}
                          className="pointer-events-none inline-block truncate text-center font-normal"
                        >
                          {user.displayName || user.username}
                        </motion.span>

                        <motion.span
                          animate={{
                            opacity: hoveredTag === user.id ? 1 : 0,
                            y: hoveredTag === user.id ? 0 : 8,
                            transition: { duration: 0.15 },
                          }}
                          className="pointer-events-none absolute inline-block truncate text-center font-medium text-xs"
                        >
                          @{user.username}
                        </motion.span>
                      </div>
                    </div>
                  </motion.div>
                </Link>
              ))}

              {isOwner && (
                <motion.div
                  className="relative"
                  layout
                  variants={tagVariants}
                  whileHover="hover"
                >
                  <Button
                    className={cn(
                      baseTagClass,
                      "h-7 border-blue-400/15 bg-blue-500/5 hover:border-blue-500/30 hover:bg-blue-500/10",
                      "font-normal"
                    )}
                    onClick={() => setIsEditing(true)}
                    size="sm"
                    variant="outline"
                  >
                    <AtSign className="mr-1 h-3 w-3 text-blue-500" />
                    <span className="text-blue-600 text-xs">Add mention</span>
                  </Button>
                  <motion.div
                    className="absolute inset-0 -z-10 rounded-full bg-blue-500/20 blur-md"
                    initial={{ opacity: 0 }}
                    whileHover={{
                      opacity: 1,
                      transition: { duration: 0.2 },
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : null}

      <Dialog onOpenChange={setIsEditing} open={isEditing}>
        <DialogContent className="rounded-xl border border-blue-500/15 shadow-blue-500/5 shadow-lg sm:max-w-[400px]">
          <DialogTitle className="flex items-center gap-2 font-medium text-base">
            <AtSign className="h-3.5 w-3.5 text-blue-500" />
            Mention People
          </DialogTitle>
          <DialogDescription
            aria-describedby="MentionTagEditor"
            className="text-muted-foreground text-xs"
          >
            Add people to notify about this post
          </DialogDescription>
          <MentionTagEditor
            initialMentions={localMentions}
            onCloseAction={() => setIsEditing(false)}
            onMentionsUpdateAction={handleMentionsUpdate}
            postId={postId}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
