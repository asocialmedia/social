"use client";

import {
  countWords,
  MAX_COMMENT_CHARS,
  MAX_COMMENT_WORDS,
} from "@asm/auth/validation";
import type { CommentData, PostData, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import {
  Clapperboard,
  ImagePlus,
  Loader2,
  SendHorizonal,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import LinkEmbedComposer from "@/components/posts/editor/link-embed-composer";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

import {
  clearCommentDraft,
  getCommentDraft,
  saveCommentDraft,
} from "./comment-draft-store";
import { CommentSuggestions } from "./comment-suggestions";
import type { CommentSuggestionsHandle } from "./comment-suggestions";
import KlipyGifPicker from "./klipy-gif-picker";
import type { KlipyGif } from "./klipy-gif-picker";
import { useSubmitCommentMutation } from "./mutations";
import { useCommentAttachments } from "./use-comment-attachments";

const SEND_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface CommentInputProps {
  applyCreated: (comment: CommentData) => void;
  autoFocus?: boolean;
  className?: string;
  // Hides the top-level composer on small screens when a floating mobile
  // editor is already pinned to the bottom (e.g. the post detail page).
  hideOnMobile?: boolean;
  onSubmitted?: () => void;
  parentId?: string;
  placeholder?: string;
  post: PostData;
  reels?: boolean;
  replyingTo?: {
    commentId?: string;
    content?: string;
    username: string;
  } | null;
  submitLabel?: string;
}

export default function CommentInput({
  applyCreated,
  autoFocus = false,
  className,
  hideOnMobile = false,
  onSubmitted,
  parentId,
  placeholder = "Add your Eddie to the flow...",
  post,
  reels = false,
  replyingTo,
  submitLabel,
}: CommentInputProps) {
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const [input, setInput] = useState(() => {
    const draft = getCommentDraft(post.id, parentId);
    if (draft && (draft.parentId ?? undefined) === (parentId ?? undefined)) {
      return draft.content;
    }
    return "";
  });
  const [suggestions, setSuggestions] = useState<{
    query: string;
    type: "tag" | "mention";
  } | null>(null);
  const [dismissedEmbedUrls, setDismissedEmbedUrls] = useState<string[]>([]);
  const suggestionsRef = useRef<CommentSuggestionsHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 24), 160);
    textarea.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- input intentionally triggers a height re-measure on every keystroke
  }, [input, adjustTextareaHeight]);

  const { toast } = useToast();

  const mutation = useSubmitCommentMutation(post.id, applyCreated);

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

  // Persist draft to storage whenever input changes
  useEffect(() => {
    saveCommentDraft(post.id, {
      content: input,
      parentId,
      replyingTo,
    });
  }, [input, parentId, post.id, replyingTo]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!user) {
      goToLogin();
      return;
    }

    if (!canSubmit || mutation.isPending || isUploading) {
      return;
    }

    mutation.mutate(
      {
        content: input.trim(),
        mediaIds,
        parentId,
        post,
      },
      {
        onSuccess: () => {
          clearCommentDraft(post.id, parentId);
          setInput("");
          setDismissedEmbedUrls([]);
          setSuggestions(null);
          reset();
          onSubmitted?.();
        },
      }
    );
  }

  const checkSuggestions = useCallback((text: string, cursorPos?: number) => {
    const cursor =
      cursorPos ?? textareaRef.current?.selectionStart ?? text.length;
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    setInput(nextVal);
    checkSuggestions(nextVal, e.target.selectionStart ?? nextVal.length);
  };

  const handleSelectTag = useCallback(
    (tag: string) => {
      const textarea = textareaRef.current;
      const cursor = textarea?.selectionStart ?? input.length;
      const textBefore = input.slice(0, cursor);
      const textAfter = input.slice(cursor);
      const match = textBefore.match(/(?:^|\s)#(?<tag>[\w-]*)$/);
      if (match?.groups) {
        const triggerStart = cursor - match.groups.tag.length - 1;
        const next = `${input.slice(0, triggerStart)}#${tag} ${textAfter}`;
        setInput(next);
        setTimeout(() => {
          textarea?.focus();
          const newPos = triggerStart + tag.length + 2;
          textarea?.setSelectionRange(newPos, newPos);
        }, 0);
      }
      setSuggestions(null);
    },
    [input]
  );

  const handleSelectMention = useCallback(
    (userToMention: UserData) => {
      const textarea = textareaRef.current;
      const cursor = textarea?.selectionStart ?? input.length;
      const textBefore = input.slice(0, cursor);
      const textAfter = input.slice(cursor);
      const match = textBefore.match(/(?:^|\s)@(?<username>[\w-]*)$/);
      if (match?.groups) {
        const triggerStart = cursor - match.groups.username.length - 1;
        const next = `${input.slice(0, triggerStart)}@${userToMention.username} ${textAfter}`;
        setInput(next);
        setTimeout(() => {
          textarea?.focus();
          const newPos = triggerStart + userToMention.username.length + 2;
          textarea?.setSelectionRange(newPos, newPos);
        }, 0);
      }
      setSuggestions(null);
    },
    [input]
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

  const [gifPickerOpen, setGifPickerOpen] = useState(false);

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

  if (!user) {
    // Guests read eddies but can't post: show a login CTA instead of the composer.
    return (
      <div className="sidebar-subcard my-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
        <p className="text-muted-foreground text-sm">
          Log in to join the conversation
        </p>
        <Button
          asChild
          className="btn-3d-gray h-8 shrink-0 rounded-full px-4 text-xs!"
          variant="ghost"
        >
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    );
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit && !mutation.isPending && !isUploading) {
        onSubmit(e);
      }
    }
  };

  return (
    <form
      className={cn(
        "my-3 w-full",
        hideOnMobile && "hidden lg:block",
        className
      )}
      onSubmit={onSubmit}
    >
      {replyingTo && (
        <p className="text-muted-foreground mb-1 pl-12 text-xs">
          Replying to{" "}
          <span className="text-primary font-medium">
            @{replyingTo.username}
          </span>
        </p>
      )}
      <div className="flex w-full items-start gap-2">
        <UserAvatar
          avatarUrl={userData?.avatarUrl || user?.image}
          className="mt-0.5 h-10 w-10 shrink-0"
        />
        <div className="relative min-w-0 flex-1">
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
          <div
            className={cn(
              "flex min-w-0 flex-col transition-all",
              reels
                ? "reels-input rounded-2xl py-1.5 pr-2 pl-3 focus-within:shadow-[0_0_0_3px_rgba(255,149,0,0.18)]"
                : "premium-input rounded-2xl py-1.5 pr-2 pl-3",
              attachments.length > 0 && "gap-2"
            )}
          >
            <textarea
              autoFocus={autoFocus}
              className="placeholder:text-muted-foreground/70 max-h-40 min-h-6 w-full resize-none bg-transparent py-2 text-sm leading-none outline-none"
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              ref={textareaRef}
              rows={1}
              value={input}
            />
            <input
              accept="image/*,.png,.jpg,.jpeg,.gif,.webp"
              aria-label="Add image or GIF attachment"
              className="sr-only"
              onChange={handleFileInputChange}
              ref={fileInputRef}
              type="file"
            />
            {attachments.length === 0 ? (
              <div className="flex shrink-0 items-center gap-1.5">
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
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    aria-label="Add image or GIF"
                    className={cn(
                      "pill-3d-hover group text-muted-foreground inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-sm font-medium active:translate-y-px",
                      (isUploading || mutation.isPending) && "opacity-50"
                    )}
                    disabled={isUploading || mutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5">
                      <ImagePlus className="size-4" />
                      <span className="max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-200 ease-in-out group-hover:max-w-32">
                        Image
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label="Search and add a GIF"
                    className={cn(
                      "pill-3d-hover group text-muted-foreground inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-sm font-medium active:translate-y-px",
                      gifPickerOpen &&
                        "bg-linear-to-b from-[#7c5cff] to-[#5a3ae0] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
                      (isUploading || mutation.isPending) && "opacity-50"
                    )}
                    disabled={isUploading || mutation.isPending}
                    onClick={() => setGifPickerOpen((prev) => !prev)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5">
                      <Clapperboard className="size-4" />
                      <span
                        className={cn(
                          "max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-200 ease-in-out",
                          gifPickerOpen ? "max-w-32" : "group-hover:max-w-32"
                        )}
                      >
                        GIFs
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={submitLabel ?? "Send eddie"}
                    className={cn(
                      "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-linear-to-b from-[#ff9500] to-[#e65500] px-4 text-sm font-semibold text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      SEND_BTN_SHADOW,
                      (!canSubmit || mutation.isPending || isUploading) &&
                        "opacity-50"
                    )}
                    disabled={!canSubmit || mutation.isPending || isUploading}
                    type="submit"
                  >
                    {mutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <span>Send</span>
                        <SendHorizonal className="size-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            {attachments.length > 0 ? (
              <>
                <div className="w-full pt-1">
                  {attachments.map((attachment) => (
                    <div
                      className={cn(
                        "group relative overflow-hidden rounded-xl border border-black/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3),0_1px_3px_rgba(0,0,0,0.1)] dark:border-white/15 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_2px_6px_rgba(0,0,0,0.3)]",
                        attachment.file?.type === "image/gif"
                          ? "flex h-36 w-auto max-w-xs items-center justify-center sm:h-44 sm:max-w-sm"
                          : "h-24 w-24"
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

                <div className="flex items-center justify-between pt-1">
                  <div>
                    {isNearLengthLimit ? (
                      <span
                        className={cn(
                          "text-[11px] font-medium tabular-nums",
                          isLengthExceeded
                            ? "text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        {wordCount}/{MAX_COMMENT_WORDS} words · {input.length}/
                        {MAX_COMMENT_CHARS} chars
                      </span>
                    ) : null}
                  </div>
                  <button
                    aria-label={submitLabel ?? "Send eddie"}
                    className={cn(
                      "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-linear-to-b from-[#ff9500] to-[#e65500] px-4 text-sm font-semibold text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
                      SEND_BTN_SHADOW,
                      (!canSubmit || mutation.isPending || isUploading) &&
                        "opacity-50"
                    )}
                    disabled={!canSubmit || mutation.isPending || isUploading}
                    type="submit"
                  >
                    {mutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <span>Send</span>
                        <SendHorizonal className="size-4" />
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <LinkEmbedComposer
            content={input}
            dismissedUrls={new Set<string>(dismissedEmbedUrls)}
            onDismiss={(url) =>
              setDismissedEmbedUrls((prev) =>
                prev.includes(url) ? prev : [...prev, url]
              )
            }
          />
        </div>
      </div>

      {/* Inline GIF picker: expands as part of the eddie bar instead of an
          external popup, so the composer stays in context. */}
      {gifPickerOpen ? (
        <div className="apple-panel mt-2 w-full rounded-2xl p-2">
          <KlipyGifPicker disabled={isUploading} onSelect={handleGifSelect} />
        </div>
      ) : null}
    </form>
  );
}
