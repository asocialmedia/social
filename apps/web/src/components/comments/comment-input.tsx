"use client";

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
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

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
  replyingTo?: { username: string } | null;
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
  const [input, setInput] = useState("");
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

  const canSubmit =
    input.trim().length > 0 || attachments.length > 0 || mediaIds.length > 0;

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
          setInput("");
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      <div className="flex w-full items-center gap-2">
        <UserAvatar
          avatarUrl={userData?.avatarUrl || user?.image}
          className={cn("shrink-0", reels ? "size-10" : "h-10 w-10")}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 transition-all",
              reels
                ? "reels-input rounded-full px-3 py-2 focus-within:shadow-[0_0_0_3px_rgba(255,149,0,0.18)]"
                : "premium-input px-3 py-1.5"
            )}
          >
            <textarea
              autoFocus={autoFocus}
              className="placeholder:text-muted-foreground/70 max-h-40 min-h-6 w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
              onChange={(e) => setInput(e.target.value)}
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
              multiple
              onChange={handleFileInputChange}
              ref={fileInputRef}
              type="file"
            />
            <button
              aria-label="Add image or GIF"
              className={cn(
                "bg-muted/70 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:translate-y-px",
                "hover:bg-linear-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:brightness-110",
                (isUploading || mutation.isPending) && "opacity-50"
              )}
              disabled={isUploading || mutation.isPending}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <ImagePlus className="size-4" />
            </button>
            <button
              aria-label="Search and add a GIF"
              className={cn(
                "bg-muted/70 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:translate-y-px",
                gifPickerOpen
                  ? "bg-linear-to-b from-[#7c5cff] to-[#5a3ae0] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                  : "hover:bg-linear-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:brightness-110",
                (isUploading || mutation.isPending) && "opacity-50"
              )}
              disabled={isUploading || mutation.isPending}
              onClick={() => setGifPickerOpen((prev) => !prev)}
              type="button"
            >
              <Clapperboard className="size-4" />
            </button>
            <button
              aria-label={submitLabel ?? "Send eddy"}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
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
                <SendHorizonal className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Inline GIF picker: expands as part of the eddie bar instead of an
          external popup, so the composer stays in context. */}
      {gifPickerOpen ? (
        <div className="apple-panel mt-2 w-full rounded-2xl p-2">
          <KlipyGifPicker disabled={isUploading} onSelect={handleGifSelect} />
        </div>
      ) : null}

      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              className={cn(
                "bg-muted/30 group relative overflow-hidden rounded-lg",
                // GIFs render at their final eddy size even while uploading so
                // the preview matches what the post will look like; regular
                // image attachments stay as small tiles.
                attachment.file?.type === "image/gif"
                  ? "flex h-48 w-72 items-center justify-center"
                  : "h-20 w-20"
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
    </form>
  );
}
