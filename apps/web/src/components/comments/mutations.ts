import { clientLog } from "@asm/config/debug";
import type { CommentsPage } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryKey } from "@tanstack/react-query";
import { MessageCirclePlus, MessageCircleX } from "lucide-react";
import { createElement } from "react";

import { useToast } from "@/lib/gooey-toast";

import { deleteComment, submitComment } from "./actions";

export function useSubmitCommentMutation(postId: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: submitComment,
    onError(error) {
      clientLog.error(error);
      toast({
        description: "Couldn't post your eddy, give it another try?",
        variant: "destructive",
      });
    },
    onSuccess: async (newComment) => {
      const queryKey: QueryKey = ["comments", postId];

      await queryClient.cancelQueries({ queryKey });

      queryClient.setQueryData<InfiniteData<CommentsPage, string | null>>(
        queryKey,
        (oldData) => {
          const firstPage = oldData?.pages[0];

          if (firstPage) {
            return {
              pageParams: oldData.pageParams,
              pages: [
                {
                  comments: [...firstPage.comments, newComment],
                  previousCursor: firstPage.previousCursor,
                },
                ...oldData.pages.slice(1),
              ],
            };
          }
        }
      );

      queryClient.invalidateQueries({
        predicate(query) {
          return !query.state.data;
        },
        queryKey,
      });

      toast({
        description: "Your eddy is live, nice one!",
        icon: createElement(MessageCirclePlus),
        title: "Eddy Created",
      });
    },
  });

  return mutation;
}

export function useDeleteCommentMutation() {
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
    onSuccess: async (deletedComment) => {
      const queryKey: QueryKey = ["comments", deletedComment.postId];

      await queryClient.cancelQueries({ queryKey });

      queryClient.setQueryData<InfiniteData<CommentsPage, string | null>>(
        queryKey,
        (oldData) => {
          if (!oldData) {
            return;
          }

          return {
            pageParams: oldData.pageParams,
            pages: oldData.pages.map((page) => ({
              comments: page.comments.filter((c) => c.id !== deletedComment.id),
              previousCursor: page.previousCursor,
            })),
          };
        }
      );

      toast({
        description: "Your eddy is gone",
        icon: createElement(MessageCircleX),
        title: "Eddy Deleted",
      });
    },
  });

  return mutation;
}
