"use client";

import type { PostData } from "@asm/db";
import { Loader2, MessageSquare, SendHorizonal } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useSubmitCommentMutation } from "@/components/comments/mutations";
import { formatNumber } from "@/lib/utils";

interface FloatingEddieBarProps {
  onOpenComments?: () => void;
  post: PostData;
}

export const FloatingEddieBar: React.FC<FloatingEddieBarProps> = ({
  post,
  onOpenComments,
}) => {
  const { user } = useSession();
  const [input, setInput] = useState("");

  const applyCreated = useCallback(() => {
    /* empty */
  }, []);
  const mutation = useSubmitCommentMutation(post.id, applyCreated);
  const canSubmit = input.trim().length > 0;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || mutation.isPending) {
        return;
      }
      mutation.mutate(
        { content: input.trim(), post },
        {
          onSuccess: () => setInput(""),
        }
      );
    },
    [canSubmit, mutation, post, input]
  );

  if (!user) {
    return (
      <Link
        className="flex h-12 items-center gap-2 rounded-full bg-black/45 px-4 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/60"
        href="/login"
      >
        <MessageSquare className="size-4.5 shrink-0" />
        <span className="truncate">Log in to add an Eddie</span>
      </Link>
    );
  }

  return (
    <form
      className="flex h-12 items-center gap-2 rounded-full bg-black/45 px-4 text-white backdrop-blur-md"
      onSubmit={handleSubmit}
    >
      <MessageSquare
        aria-hidden="true"
        className="size-4.5 shrink-0 text-white/70"
      />
      <input
        aria-label="Add your Eddie to the flow"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/50"
        onChange={(e) => setInput(e.target.value)}
        placeholder="Add your Eddie..."
        value={input}
      />
      <button
        aria-label="Send eddy"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-opacity disabled:opacity-50"
        disabled={!canSubmit || mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <SendHorizonal className="size-4" />
        )}
      </button>
      <button
        aria-label={`View comments (${formatNumber(post._count.comments)})`}
        className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 text-xs font-semibold transition-colors hover:bg-white/20"
        onClick={onOpenComments}
        type="button"
      >
        {formatNumber(post._count.comments)}
      </button>
    </form>
  );
};
