"use client";

import { MAX_COMMENT_CHARS, MAX_COMMENT_WORDS } from "@asm/auth/validation";
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
import { CommentSuggestions } from "@/components/comments/comment-suggestions";
import type { CommentSuggestionsHandle } from "@/components/comments/comment-suggestions";
import { useCommentsRealtimeValue } from "@/components/comments/comments-realtime-context";
import KlipyGifPicker from "@/components/comments/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/klipy-gif-picker";
import { useSubmitCommentMutation } from "@/components/comments/mutations";
import { useCommentAttachments } from "@/components/comments/use-comment-attachments";
import { useCommentsRealtime } from "@/components/comments/use-comments-realtime";
import type { LiveCommentStore } from "@/components/comments/use-comments-realtime";
import UserAvatar from "@/components/layouts/user-avatar";
import LinkEmbedComposer from "@/components/posts/editor/link-embed-composer";
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

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

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
  const [suggestions, setSuggestions] = useState<{
    query: string;
    type: "tag" | "mention";
  } | null>(null);
  const [dismissedEmbedUrls, setDismissedEmbedUrls] = useState<string[]>([]);
  const suggestionsRef = useRef<CommentSuggestionsHandle>(null);
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
  // visible and doesn't get covered. The visual viewport's own scroll
  // (offsetTop) is subtracted too, otherwise the offset over-counts by that
  // scroll and leaves a dead gap between the bar and the keyboard.
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const { visualViewport } = window;
    if (!visualViewport) {
      return;
    }
    const updateOffset = () => {
      const offset =
        window.innerHeight - (visualViewport.height + visualViewport.offsetTop);
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

  const wordCount = countWords(input);
  const isLengthExceeded =
    wordCount > MAX_COMMENT_WORDS || input.length > MAX_COMMENT_CHARS;
  const isNearLengthLimit =
    wordCount >= MAX_COMMENT_WORDS * 0.8 ||
    input.length >= MAX_COMMENT_CHARS * 0.8;

  const canSubmit =
    (input.trim().length > 0 ||
      attachments.length > 0 ||
      mediaIds.length > 0) &&
    !isLengthExceeded;

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
          setDismissedEmbedUrls([]);
          setSuggestions(null);
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

  const checkSuggestions = useCallback((text: string, cursorPos?: number) => {
    const cursor = cursorPos ?? inputRef.current?.selectionStart ?? text.length;
    const textBefore = text.slice(Math.max(0, cursor - 50), cursor);
    const match = textBefore.match(/(?:^|\s)(?<trigger>[#@])(?<query>[\w-]*)$/);
    if (match?.groups) {
      setSuggestions({
        query: match.groups.query || "",
        type: match.groups.trigger === "#" ? "tag" : "mention",
      });
    } else {
      setSuggestions(null);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextVal = e.target.value;
      setInput(nextVal);
      checkSuggestions(nextVal, e.target.selectionStart ?? nextVal.length);
    },
    [checkSuggestions]
  );

  const handleSelectTag = useCallback(
    (tag: string) => {
      const inputEl = inputRef.current;
      const cursor = inputEl?.selectionStart ?? input.length;
      const textBefore = input.slice(0, cursor);
      const textAfter = input.slice(cursor);
      const match = textBefore.match(/(?:^|\s)#(?<tag>[\w-]*)$/);
      if (match?.groups) {
        const triggerStart = cursor - match.groups.tag.length - 1;
        const next = `${input.slice(0, triggerStart)}#${tag} ${textAfter}`;
        setInput(next);
        setTimeout(() => {
          inputEl?.focus();
          const newPos = triggerStart + tag.length + 2;
          inputEl?.setSelectionRange(newPos, newPos);
        }, 0);
      }
      setSuggestions(null);
    },
    [input]
  );

  const handleSelectMention = useCallback(
    (userToMention: UserData) => {
      const inputEl = inputRef.current;
      const cursor = inputEl?.selectionStart ?? input.length;
      const textBefore = input.slice(0, cursor);
      const textAfter = input.slice(cursor);
      const match = textBefore.match(/(?:^|\s)@(?<username>[\w-]*)$/);
      if (match?.groups) {
        const triggerStart = cursor - match.groups.username.length - 1;
        const next = `${input.slice(0, triggerStart)}@${userToMention.username} ${textAfter}`;
        setInput(next);
        setTimeout(() => {
          inputEl?.focus();
          const newPos = triggerStart + userToMention.username.length + 2;
          inputEl?.setSelectionRange(newPos, newPos);
        }, 0);
      }
      setSuggestions(null);
    },
    [input]
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
      if (suggestions) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          suggestionsRef.current?.moveDown();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          suggestionsRef.current?.moveUp();
          return;
        }
        if (
          (e.key === "Enter" || e.key === "Tab") &&
          suggestionsRef.current?.selectActive()
        ) {
          e.preventDefault();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSuggestions(null);
          return;
        }
      }

      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, suggestions]
  );

  const handleFilesSelected = useCallback(
    (files: FileList | null) => {
      if (files) {
        setIsExpanded(true);
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
      setIsExpanded(true);
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
        "bg-background/95 fixed right-0 bottom-0 left-0 z-40 border-t border-white/10 p-2 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] backdrop-blur-md transition-transform duration-200 lg:hidden",
        replyOpen && "translate-y-full"
      )}
      onBlur={handleBarBlur}
      style={{
        bottom: `${keyboardOffset}px`,
      }}
    >
      <div className="relative mx-auto max-w-lg">
        {suggestions ? (
          <CommentSuggestions
            onClose={() => setSuggestions(null)}
            onSelectMention={handleSelectMention}
            onSelectTag={handleSelectTag}
            query={suggestions.query}
            ref={suggestionsRef}
            type={suggestions.type}
          />
        ) : null}

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
          <AnimatePresence initial={false}>
            {!isExpanded && (
              <motion.button
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] px-4 text-sm font-medium text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
                  SEND_BTN_SHADOW,
                  !canSubmit && "opacity-50"
                )}
                disabled={!canSubmit}
                exit={{ opacity: 0, scale: 0.85 }}
                initial={{ opacity: 0, scale: 0.85 }}
                onClick={handleSubmit}
                transition={{ duration: 0.15 }}
                type="button"
              >
                {mutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SendHorizonal className="size-4" />
                )}
                Send
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
              <input
                accept="image/*,.png,.jpg,.jpeg,.gif,.webp"
                aria-label="Add image or GIF attachment"
                className="sr-only"
                onChange={handleFileInputChange}
                ref={fileInputRef}
                type="file"
              />

              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <div
                      className={cn(
                        "group relative overflow-hidden rounded-xl border border-black/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3),0_1px_3px_rgba(0,0,0,0.1)] dark:border-white/15 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_2px_6px_rgba(0,0,0,0.3)]",
                        attachment.file?.type === "image/gif"
                          ? "flex h-36 w-56 items-center justify-center sm:h-44 sm:w-64"
                          : "h-20 w-20"
                      )}
                      key={attachment.objectUrl}
                    >
                      <Image
                        alt="Attachment preview"
                        className="h-full w-full object-cover"
                        fill
                        src={attachment.objectUrl}
                      />
                      <div className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_2px_rgba(255,255,255,0.3)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),inset_0_1px_2px_rgba(255,255,255,0.06)]" />
                      {attachment.isUploading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-xs">
                          <Loader2 className="size-5 animate-spin text-white" />
                        </div>
                      ) : (
                        <button
                          aria-label="Remove attachment"
                          className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(255,255,255,0.25)] transition-all hover:scale-105 hover:bg-black/90"
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

              <div className="mt-2 flex items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-2">
                  {attachments.length === 0 ? (
                    <div className="flex items-center gap-1">
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
                  ) : null}
                  {isNearLengthLimit ? (
                    <span
                      className={cn(
                        "text-[11px] font-medium tabular-nums",
                        isLengthExceeded
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {wordCount}/{MAX_COMMENT_WORDS}w · {input.length}/
                      {MAX_COMMENT_CHARS}c
                    </span>
                  ) : null}
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

              {gifPickerOpen ? (
                <div className="apple-panel mt-2 w-full rounded-2xl p-2">
                  <KlipyGifPicker
                    disabled={isUploading}
                    onSelect={handleGifSelect}
                  />
                </div>
              ) : null}

              <LinkEmbedComposer
                content={input}
                dismissedUrls={new Set<string>(dismissedEmbedUrls)}
                onDismiss={(url) =>
                  setDismissedEmbedUrls((prev) =>
                    prev.includes(url) ? prev : [...prev, url]
                  )
                }
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FloatingPostEditor;
