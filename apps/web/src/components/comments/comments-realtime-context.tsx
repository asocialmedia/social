"use client";

import type { CommentData } from "@asm/db";
import type { MutableRefObject, ReactNode } from "react";
import { createContext, useContext, useMemo, useRef } from "react";

import { useCommentsRealtime } from "./use-comments-realtime";
import type { LiveCommentStore } from "./use-comments-realtime";

export interface CommentsRealtimeValue {
  applyCreated: (comment: CommentData) => void;
  applyDeleted: (comment: CommentData) => void;
  liveStoreRef: MutableRefObject<LiveCommentStore>;
}

const CommentsRealtimeContext = createContext<CommentsRealtimeValue | null>(
  null
);

// Shares one realtime store per post across every consumer on the page: the
// comments list, the inline composer and the mobile floating composer all
// write to the same map, so an eddy posted from any of them shows up in all of
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

  const value = useMemo<CommentsRealtimeValue>(
    () => ({
      applyCreated,
      applyDeleted,
      liveStoreRef,
    }),
    [applyCreated, applyDeleted, liveStoreRef]
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
