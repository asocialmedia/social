"use client";

import type { CommentData, PostData, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Loader2, SendHorizonal, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { useRequireAuth } from "@/hooks/use-require-auth";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

import { useSubmitCommentMutation } from "./mutations";
import { useCommentAttachments } from "./use-comment-attachments";

const SEND_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface CommentInputProps {
  applyCreated: (comment: CommentData) => void;
  autoFocus?: boolean;
  className?: string;
  onSubmitted?: () => void;
  parentId?: string;
  placeholder?: string;
  post: PostData;
  replyingTo?: { username: string } | null;
  submitLabel?: string;
}

export default function CommentInput({
  applyCreated,
  autoFocus = false,
  className,
  onSubmitted,
  parentId,
  placeholder = "Add your Eddie to the flow...",
  post,
  replyingTo,
  submitLabel,
}: CommentInputProps) {
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      className={cn("my-3 flex w-full items-start gap-2", className)}
      onSubmit={onSubmit}
    >
      <UserAvatar
        avatarUrl={userData?.avatarUrl || user?.image}
        className="h-10 w-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        {replyingTo && (
          <p className="text-muted-foreground mb-1 text-xs">
            Replying to{" "}
            <span className="text-primary font-medium">
              @{replyingTo.username}
            </span>
          </p>
        )}
        <div className="bg-muted/30 focus-within:border-primary/40 flex min-w-0 items-center gap-2 rounded-xl border border-transparent px-3 py-2 transition-colors focus-within:bg-transparent">
          <textarea
            autoFocus={autoFocus}
            className="placeholder:text-muted-foreground/70 max-h-40 min-h-6 w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            rows={1}
            value={input}
          />
          <input
            accept="image/*,video/*,.png,.jpg,.jpeg,.gif,.mp4,.mov,.webm"
            className="sr-only"
            multiple
            onChange={handleFileInputChange}
            ref={fileInputRef}
            type="file"
          />
          <button
            aria-label="Add image or video"
            className="text-muted-foreground hover:text-foreground shrink-0 rounded-full p-1.5 transition-colors"
            disabled={isUploading || mutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <ImagePlus className="size-5" />
          </button>
          <button
            aria-label={submitLabel ?? "Send eddy"}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
              SEND_BTN_SHADOW,
              (!canSubmit || mutation.isPending || isUploading) && "opacity-50"
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

        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                className="bg-muted/30 group relative h-20 w-20 overflow-hidden rounded-lg"
                key={attachment.objectUrl}
              >
                {attachment.file.type.startsWith("video/") ? (
                  // oxlint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded previews don't carry captions yet
                  <video
                    className="h-full w-full object-cover"
                    src={attachment.objectUrl}
                  />
                ) : (
                  <Image
                    alt="Attachment preview"
                    className="h-full w-full object-cover"
                    fill
                    src={attachment.objectUrl}
                  />
                )}
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
      </div>
    </form>
  );
}
