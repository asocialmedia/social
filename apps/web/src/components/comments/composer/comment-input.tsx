"use client";

import {
  countWords,
  MAX_COMMENT_CHARS,
  MAX_COMMENT_WORDS,
} from "@asm/auth/validation";
import type { CommentData, PostData, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
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
import UserAvatar from "@/components/layouts/user/user-avatar";
import { InlineRichEditor } from "@/components/posts/editor/inline-rich-editor";
import LinkEmbedComposer from "@/components/posts/editor/link-embed-composer";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

import { useSubmitCommentMutation } from "../data/mutations";
import {
  clearCommentDraft,
  getCommentDraft,
  saveCommentDraft,
} from "./comment-draft-store";
import KlipyGifPicker from "./klipy-gif-picker";
import type { KlipyGif } from "./klipy-gif-picker";
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
  onCancel?: () => void;
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
  onCancel,
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
  const [dismissedEmbedUrls, setDismissedEmbedUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);

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

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();

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
          editorRef.current?.commands.clearContent();
          reset();
          onSubmitted?.();
        },
      }
    );
  }

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

  return (
    <form
      className={cn(
        "my-3 w-full",
        hideOnMobile && "hidden lg:block",
        className
      )}
      onSubmit={onSubmit}
    >
      <div className="flex w-full items-start gap-2.5">
        <UserAvatar
          avatarUrl={userData?.avatarUrl || user?.image}
          className="h-10 w-10 shrink-0"
        />
        <div className="relative min-w-0 flex-1">
          {replyingTo && (
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Replying to{" "}
                <span className="text-primary font-medium">
                  @{replyingTo.username}
                </span>
              </p>
              {onCancel && (
                <button
                  className="text-muted-foreground hover:text-foreground cursor-pointer text-xs transition-colors"
                  onClick={onCancel}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          <div
            className={cn(
              "flex min-w-0 flex-col transition-all",
              reels
                ? "reels-input rounded-2xl py-1.5 pr-2 pl-3 focus-within:shadow-[0_0_0_3px_rgba(255,149,0,0.18)]"
                : "premium-input rounded-2xl py-1.5 pr-2 pl-3",
              attachments.length > 0 && "gap-2"
            )}
          >
            <InlineRichEditor
              autoFocus={autoFocus}
              editorClassName="max-h-40 min-h-6 w-full overflow-y-auto py-2 text-sm leading-relaxed"
              editorRef={editorRef}
              initialContent={input}
              onChange={setInput}
              onSubmit={onSubmit}
              placeholder={placeholder}
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
