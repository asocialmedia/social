import { clientLog } from "@asm/config/debug";
import type { PostsPage } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { useToast } from "@/lib/gooey-toast";

import { submitPost, updatePostMentions } from "./actions";

interface PostInput {
  content: string;
  hnStory?: {
    storyId: number;
    title: string;
    url?: string;
    by: string;
    time: number;
    score: number;
    descendants: number;
  };
  isGust?: boolean;
  mediaIds: string[];
  mentions: string[];
  tags: string[];
}

export function useSubmitPostMutation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: PostInput) => {
      const payload = {
        content: input.content,
        hnStory: input.hnStory,
        isGust: input.isGust ?? false,
        mediaIds: input.mediaIds,
        mentions: Array.isArray(input.mentions)
          ? input.mentions.filter(Boolean)
          : [],
        tags: input.tags,
      };

      const response = await submitPost(payload);
      if (!response) {
        throw new Error("Failed to create post");
      }
      return response;
    },
    onError(error) {
      clientLog.error("Post creation error:", error);
      toast({
        description: "Couldn't create your post, try again?",
        variant: "destructive",
      });
    },
    onSuccess: async (newPost) => {
      // Gusts live on the dedicated /gusts feed, not the home "for-you" feed
      // (which filters isGust=false server-side). Only prepend regular posts
      // to the home feed cache; gusts are invalidated separately below so the
      // user is redirected to /gusts and sees the new clip there.
      if (!newPost.isGust) {
        const queryFilter = { queryKey: ["post-feed", "for-you"] };

        await queryClient.cancelQueries(queryFilter);

        queryClient.setQueriesData<InfiniteData<PostsPage, string | null>>(
          queryFilter,
          (oldData) => {
            if (!oldData?.pages[0]) {
              return oldData;
            }

            return {
              pageParams: oldData.pageParams,
              pages: [
                {
                  nextCursor: oldData.pages[0].nextCursor,
                  posts: [newPost, ...oldData.pages[0].posts],
                },
                ...oldData.pages.slice(1),
              ],
            };
          }
        );
      }

      queryClient.invalidateQueries({ queryKey: ["popularTags"] });
      if (newPost.isGust) {
        queryClient.invalidateQueries({ queryKey: ["gusts-feed"] });
        queryClient.invalidateQueries({ queryKey: ["explore-gusts-grid"] });
        queryClient.invalidateQueries({ queryKey: ["explore-top-gusts"] });
      }
      const isHnShare = !!newPost.hnStoryShare;

      let description: string;
      let title: string;
      if (isHnShare) {
        description = "Your thoughts on this story are live";
        title = "Story Shared";
      } else if (newPost.isGust) {
        description = "Your gust is live, the feed's about to pop off!";
        title = "Gust Published";
      } else {
        description = "Your post is live, nice one!";
        title = "Post Published";
      }

      toast({
        description,
        duration: 5000,
        title,
      });
    },
  });

  return mutation;
}

export function useUpdateMentionsMutation(postId?: string) {
  // No changes needed here
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mentions: string[]) => {
      if (!postId) {
        throw new Error("Post ID is required to update mentions");
      }
      const response = await updatePostMentions(postId, mentions);
      if (!response) {
        throw new Error("Failed to update mentions");
      }
      return response;
    },
    onError: (error) => {
      clientLog.error("Failed to update mentions:", error);
      toast({
        description: "Couldn't update mentions, try again?",
        variant: "destructive",
      });
    },
    onSuccess: (updatedPost) => {
      if (postId) {
        queryClient.setQueryData(["post", postId], updatedPost);
      }
      toast({
        description: "Everyone you mentioned has been notified",
        duration: 3000,
        title: "Mentions Updated",
      });
    },
  });
}
