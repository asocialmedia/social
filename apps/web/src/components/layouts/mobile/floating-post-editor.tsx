"use client";

import type { PostData, UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import {
  Clapperboard,
  ImageIcon,
  Loader2,
  SendHorizonal,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useCommentsRealtimeValue } from "@/components/comments/comments-realtime-context";
import KlipyGifPicker from "@/components/comments/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/klipy-gif-picker";
import { useSubmitCommentMutation } from "@/components/comments/mutations";
import { useCommentAttachments } from "@/components/comments/use-comment-attachments";
import { useCommentsRealtime } from "@/components/comments/use-comments-realtime";
import type { LiveCommentStore } from "@/components/comments/use-comments-realtime";
import UserAvatar from "@/components/layouts/user-avatar";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

const SEND_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

// Post-card 3D action buttons: muted gray at rest, blooming to the orange
// (image) or purple (gif open) gradient on hover/active like the vote buttons.
const ICON_BTN_BASE =
  "bg-muted/70 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:translate-y-px";
const ICON_BTN_HOVER =
  "hover:bg-linear-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:brightness-110";
const ICON_BTN_PURPLE =
  "bg-linear-to-b from-[#7c5cff] to-[#5a3ae0] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface FloatingPostEditorProps {
  post: PostData;
}

const FloatingPostEditor: React.FC<FloatingPostEditorProps> = ({ post }) => {
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const { toast } = useToast();
  const shared = useCommentsRealtimeValue();
  const replyOpen = shared?.replyOpen ?? false;
  const ownStoreRef = useRef<LiveCommentStore>(new Map());
  const ownRealtime = useCommentsRealtime(post.id, ownStoreRef, !shared);
  const applyCreated = shared?.applyCreated ?? ownRealtime.applyCreated;
  const mutation = useSubmitCommentMutation(post.id, applyCreated);
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    attachments,
    isUploading,
    mediaIds,
    removeAttachment,
    reset,
    startUpload,
  } = useCommentAttachments();

  const { data: userData } = useQuery({
    enabled: Boolean(user),
    queryFn: () => kyInstance.get(`/api/users/${user?.id}`).json<UserData>(),
    queryKey: ["user", user?.id],
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

  const canSubmit =
    input.trim().length > 0 || attachments.length > 0 || mediaIds.length > 0;

  const handleSubmit = useCallback(() => {
    if (!user) {
      goToLogin();
      return;
    }
    if (!canSubmit || mutation.isPending || isUploading) {
      return;
    }
    mutation.mutate(
      { content: input.trim(), mediaIds, post },
      {
        onSuccess: () => {
          setInput("");
          reset();
          setGifPickerOpen(false);
          setIsExpanded(false);
          inputRef.current?.blur();
        },
      }
    );
  }, [
    canSubmit,
    input,
    mediaIds,
    mutation,
    post,
    user,
    goToLogin,
    isUploading,
    reset,
  ]);

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

  const handleFilesSelected = useCallback(
    (files: FileList | null) => {
      if (files) {
        void startUpload([...files]);
      }
    },
    [startUpload]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFilesSelected(e.target.files);
      e.target.value = "";
    },
    [handleFilesSelected]
  );

  const handleGifSelect = useCallback(
    async (gif: KlipyGif) => {
      setGifPickerOpen(false);
      try {
        const blob = await fetch(gif.url).then((r) => {
          if (!r.ok) {
            throw new Error("Failed to fetch GIF");
          }
          return r.blob();
        });
        const file = new File([blob], `${gif.slug || "gif"}.gif`, {
          type: "image/gif",
        });
        await startUpload([file]);
      } catch {
        toast({
          description: "Couldn't add that GIF, try another?",
          title: "GIF Failed",
          variant: "destructive",
        });
      }
    },
    [startUpload, toast]
  );

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-50 px-3 pb-3 lg:hidden",
        replyOpen && "hidden"
      )}
      style={{ bottom: keyboardOffset }}
    >
      <div
        className="border-border/60 rounded-2xl border bg-[hsl(var(--background-alt))]/95 p-2 shadow-lg backdrop-blur-md"
        onBlur={handleBarBlur}
      >
        <div className="flex items-center gap-2">
          <UserAvatar
            avatarUrl={userData?.avatarUrl || user?.image}
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
                aria-label="Send eddie"
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
                  <input
                    accept="image/*,.png,.jpg,.jpeg,.gif,.webp"
                    aria-label="Add image or GIF attachment"
                    className="sr-only"
                    multiple
                    onChange={handleFileInputChange}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    aria-label="Add image or GIF"
                    className={cn(
                      ICON_BTN_BASE,
                      ICON_BTN_HOVER,
                      (isUploading || mutation.isPending) && "opacity-50"
                    )}
                    disabled={isUploading || mutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <ImageIcon className="size-4" />
                  </button>
                  <button
                    aria-label="Search and add a GIF"
                    className={cn(
                      ICON_BTN_BASE,
                      gifPickerOpen ? ICON_BTN_PURPLE : ICON_BTN_HOVER,
                      (isUploading || mutation.isPending) && "opacity-50"
                    )}
                    disabled={isUploading || mutation.isPending}
                    onClick={() => setGifPickerOpen((prev) => !prev)}
                    type="button"
                  >
                    <Clapperboard className="size-4" />
                  </button>
                </div>
                <button
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] px-4 text-sm font-medium text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
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

              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <div
                      className={cn(
                        "bg-muted/30 group relative overflow-hidden rounded-lg",
                        attachment.file?.type === "image/gif"
                          ? "flex h-32 w-48 items-center justify-center"
                          : "h-16 w-16"
                      )}
                      key={attachment.objectUrl}
                    >
                      <Image
                        alt="Attachment preview"
                        className={cn(
                          "h-full w-full",
                          attachment.file?.type === "image/gif"
                            ? "object-contain"
                            : "object-cover"
                        )}
                        fill
                        src={attachment.objectUrl}
                      />
                      {attachment.isUploading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 className="size-5 animate-spin text-white" />
                        </div>
                      ) : (
                        <button
                          aria-label="Remove attachment"
                          className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => removeAttachment(attachment.objectUrl)}
                          type="button"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {gifPickerOpen ? (
                <div className="apple-panel mt-2 w-full rounded-2xl p-2">
                  <KlipyGifPicker
                    disabled={isUploading}
                    onSelect={handleGifSelect}
                  />
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FloatingPostEditor;
