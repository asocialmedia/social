"use client";

import type { CommentData } from "@asm/db";
import type { MutableRefObject, ReactNode } from "react";
import { createContext, useContext, useMemo, useRef, useState } from "react";

import { getCommentDraft } from "./comment-draft-store";
import { useCommentsRealtime } from "./use-comments-realtime";
import type { LiveCommentStore } from "./use-comments-realtime";

export interface ReplyingToTarget {
  commentId?: string;
  content?: string;
  username: string;
}

export interface CommentsRealtimeValue {
  applyCreated: (comment: CommentData) => void;
  applyDeleted: (comment: CommentData) => void;
  // Indicates that a floating mobile composer is actively mounted on this page
  hasFloatingComposer?: boolean;
  liveStoreRef: MutableRefObject<LiveCommentStore>;
  // Active reply target when replying via the mobile floating composer
  replyingTo: ReplyingToTarget | null;
  setReplyingTo: (target: ReplyingToTarget | null) => void;
  // True while a desktop inline reply composer is open
  setReplyOpen: (open: boolean) => void;
  replyOpen: boolean;
}

const CommentsRealtimeContext = createContext<CommentsRealtimeValue | null>(
  null
);

// Shares one realtime store per post across every consumer on the page: the
// comments list, the inline composer and the mobile floating composer all
// write to the same map, so an eddie posted from any of them shows up in all of
// them without a refetch.
export function CommentsRealtimeProvider({
  children,
  postId,
}: {
  children: ReactNode;
  postId: string;
}) {
  const liveStoreRef = useRef<LiveCommentStore>(new Map());
  const { applyCreated, applyDeleted } = useCommentsRealtime(
    postId,
    liveStoreRef
  );
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReplyingToTarget | null>(
    () => getCommentDraft(postId)?.replyingTo ?? null
  );

  const value = useMemo<CommentsRealtimeValue>(
    () => ({
      applyCreated,
      applyDeleted,
      hasFloatingComposer: true,
      liveStoreRef,
      replyOpen,
      replyingTo,
      setReplyOpen,
      setReplyingTo,
    }),
    [
      applyCreated,
      applyDeleted,
      liveStoreRef,
      replyOpen,
      replyingTo,
      setReplyOpen,
      setReplyingTo,
    ]
  );

  return (
    <CommentsRealtimeContext.Provider value={value}>
      {children}
    </CommentsRealtimeContext.Provider>
  );
}

export function useCommentsRealtimeValue(): CommentsRealtimeValue | null {
  return useContext(CommentsRealtimeContext);
}
