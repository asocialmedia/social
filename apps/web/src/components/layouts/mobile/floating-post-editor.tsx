"use client";

import type { PostData, UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  ImageIcon,
  Loader2,
  SendHorizonal,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/app/(main)/session-provider";
import { useSubmitCommentMutation } from "@/components/comments/mutations";
import UserAvatar from "@/components/layouts/user-avatar";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

const SEND_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface FloatingPostEditorProps {
  post: PostData;
}

const UPLOAD_OPTIONS = [
  { icon: ImageIcon, label: "Photos & Videos" },
  { icon: FileAudioIcon, label: "Audio" },
  { icon: FileIcon, label: "Document" },
  { icon: FileCode, label: "Code" },
];

const UploadButton: React.FC<{
  icon: typeof ImageIcon;
  label: string;
  onClick: (label: string) => void;
}> = ({ icon: Icon, label, onClick }) => {
  const handleClick = useCallback(() => {
    onClick(label);
  }, [label, onClick]);

  return (
    <button
      aria-label={label}
      className="pill-3d-hover inline-flex h-8 items-center justify-center rounded-full px-2 text-muted-foreground active:translate-y-px"
      onClick={handleClick}
      type="button"
    >
      <Icon className="size-5" />
    </button>
  );
};

const FloatingPostEditor: React.FC<FloatingPostEditorProps> = ({ post }) => {
  const { user } = useSession();
  const { toast } = useToast();
  const mutation = useSubmitCommentMutation(post.id);
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: userData } = useQuery({
    queryKey: ["user", user.id],
    queryFn: () => kyInstance.get(`/api/users/${user.id}`).json<UserData>(),
    staleTime: 1000 * 60 * 5,
  });

  const inputRef = useRef<HTMLInputElement>(null);

  // Lift the bar above the on-screen keyboard: when the visual viewport
  // shrinks (keyboard opens), offset the bar by the difference so it stays
  // visible and doesn't get covered.
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const { visualViewport } = window;
    if (!visualViewport) {
      return;
    }
    const updateOffset = () => {
      const offset = window.innerHeight - visualViewport.height;
      setKeyboardOffset(Math.max(0, offset));
    };
    visualViewport.addEventListener("resize", updateOffset);
    visualViewport.addEventListener("scroll", updateOffset);
    updateOffset();
    return () => {
      visualViewport.removeEventListener("resize", updateOffset);
      visualViewport.removeEventListener("scroll", updateOffset);
    };
  }, []);

  const canSubmit = input.trim().length > 0 && !mutation.isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    mutation.mutate(
      { post, content: input.trim() },
      {
        onSuccess: () => {
          setInput("");
          setIsExpanded(false);
          inputRef.current?.blur();
        },
      }
    );
  }, [canSubmit, input, mutation, post]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInput(e.target.value);
    },
    []
  );

  const handleFocus = useCallback(() => {
    setIsExpanded(true);
  }, []);

  // Collapse when focus leaves the whole bar, but keep it open while the
  // user is interacting with the upload/send buttons inside it.
  const handleBarBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsExpanded(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleUploadClick = useCallback(
    (label: string) => {
      toast({
        title: "Coming soon",
        description: `Attachments for ${label.toLowerCase()} aren't supported on eddies yet.`,
      });
    },
    [toast]
  );

  return (
    <div
      className="fixed inset-x-0 z-50 px-3 pb-3 lg:hidden"
      style={{ bottom: keyboardOffset }}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Container needs a blur handler to detect focus leaving the bar
      biome-ignore lint/a11y/noStaticElementInteractions: Container needs a blur handler to detect focus leaving the bar */}
      <div
        className="rounded-2xl border border-border/60 bg-[hsl(var(--background-alt))]/95 p-2 shadow-lg backdrop-blur-md"
        onBlur={handleBarBlur}
      >
        <div className="flex items-center gap-2">
          <UserAvatar
            avatarUrl={userData?.avatarUrl || user.image}
            className="h-9 w-9 shrink-0"
          />
          <input
            className="premium-input h-10 min-w-0 flex-1 rounded-xl px-3 text-sm focus:outline-none"
            onChange={handleInputChange}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder="Add your Eddie to the flow..."
            ref={inputRef}
            value={input}
          />
          <AnimatePresence>
            {isExpanded ? null : (
              <motion.button
                animate={{ opacity: 1, scale: 1 }}
                aria-label="Send eddy"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
                  SEND_BTN_SHADOW,
                  !canSubmit && "opacity-50"
                )}
                disabled={!canSubmit}
                exit={{ opacity: 0, scale: 0.6 }}
                initial={{ opacity: 0, scale: 0.6 }}
                onClick={handleSubmit}
                transition={{ duration: 0.15 }}
                type="button"
              >
                <SendHorizonal className="size-5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              <div className="mt-2 flex items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-1">
                  {UPLOAD_OPTIONS.map(({ icon, label }) => (
                    <UploadButton
                      icon={icon}
                      key={label}
                      label={label}
                      onClick={handleUploadClick}
                    />
                  ))}
                </div>
                <button
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] px-4 font-medium text-sm text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
                    SEND_BTN_SHADOW,
                    !canSubmit && "opacity-50"
                  )}
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                  type="button"
                >
                  {mutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <SendHorizonal className="size-4" />
                  )}
                  Send
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FloatingPostEditor;
