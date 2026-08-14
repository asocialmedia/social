"use client";

import { clientLog } from "@asm/config/debug";
import type { CommentData, PostData } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { MessageCirclePlus, MessageCircleX } from "lucide-react";
import { createElement } from "react";

import { useToast } from "@/lib/gooey-toast";

import { deleteComment, submitComment } from "./actions";

interface SubmitCommentInput {
  content: string;
  mediaIds?: string[];
  parentId?: string;
  post: PostData;
}

// Keeps the post's comment count on the detail page in sync without refetching
// the whole feed. Soft-deleting a comment with replies still removes it from
// the count because a removed eddy is no longer a comment.
function bumpCommentCount(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
  delta: number
) {
  const queryKey: QueryKey = ["post", postId];
  queryClient.setQueryData(queryKey, (oldPost: unknown) => {
    if (!oldPost || typeof oldPost !== "object") {
      return oldPost;
    }
    const current = oldPost as { _count?: { comments?: number } };
    if (!current._count) {
      return oldPost;
    }
    return {
      ...current,
      _count: {
        ...current._count,
        comments: Math.max(0, (current._count.comments ?? 0) + delta),
      },
    };
  });
}

export function useSubmitCommentMutation(
  postId: string,
  applyCreated: (comment: CommentData) => void
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: SubmitCommentInput) => {
      const { content, mediaIds, parentId, post } = input;
      return await submitComment({ content, mediaIds, parentId, post });
    },
    onError(error) {
      clientLog.error(error);
      toast({
        description: "Couldn't post your eddy, give it another try?",
        variant: "destructive",
      });
    },
    onSuccess: (newComment) => {
      applyCreated(newComment);

      // Reconcile any in-flight server pages with the new comment and drop
      // stale refetch results.
      const queryKey: QueryKey = ["comments", postId];
      queryClient.invalidateQueries({ queryKey });

      bumpCommentCount(queryClient, postId, 1);

      toast({
        description: "Your eddy is live, nice one!",
        icon: createElement(MessageCirclePlus),
        title: "Eddy Created",
      });
    },
  });

  return mutation;
}

export function useDeleteCommentMutation(
  applyDeleted: (comment: CommentData) => void
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: deleteComment,
    onError(error) {
      clientLog.error(error);
      toast({
        description: "Couldn't delete your eddy, try again?",
        variant: "destructive",
      });
    },
    onSuccess: (deletedComment) => {
      applyDeleted(deletedComment);
      bumpCommentCount(queryClient, deletedComment.postId, -1);

      toast({
        description: "Your eddy is gone",
        icon: createElement(MessageCircleX),
        title: "Eddy Deleted",
      });
    },
  });

  return mutation;
}
