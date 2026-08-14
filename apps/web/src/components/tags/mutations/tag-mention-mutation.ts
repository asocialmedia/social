import type { PostData, TagWithCount, UserData } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";

import { updatePostInCaches } from "./cache-utils";

interface TagsMutationContext {
  previousPost: PostData | undefined;
}

interface MentionsMutationContext {
  previousPost: PostData | undefined;
}

export function useUpdateTagsMutation(postId?: string) {
  const queryClient = useQueryClient();

  return useMutation<PostData, Error, string[], TagsMutationContext>({
    mutationFn: async (tags) => {
      const response = await fetch(`/api/posts/${postId}/tags`, {
        body: JSON.stringify({ tags }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to update tags");
      }
      return response.json();
    },
    onError: (_, __, context) => {
      if (postId && context?.previousPost) {
        updatePostInCaches(
          queryClient,
          postId,
          () => context.previousPost as PostData
        );
      }
    },
    onMutate: async (newTags) => {
      if (!postId) {
        return { previousPost: undefined };
      }

      await queryClient.cancelQueries({ queryKey: ["post", postId] });
      const previousPost = queryClient.getQueryData<PostData>(["post", postId]);
      const optimisticTags: TagWithCount[] = newTags.map((name) => ({
        _count: { posts: 1 },
        createdAt: new Date(),
        id: name,
        name,
        updatedAt: new Date(),
      }));

      updatePostInCaches(queryClient, postId, (post) => ({
        ...post,
        tags: optimisticTags,
      }));

      return { previousPost };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
      queryClient.invalidateQueries({ queryKey: ["popularTags"] });
    },
  });
}

export function useUpdateMentionsMutation(postId?: string) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useSession();

  return useMutation<PostData, Error, string[], MentionsMutationContext>({
    mutationFn: async (userIds) => {
      const filteredUserIds = currentUser
        ? userIds.filter((id) => id !== currentUser.id)
        : userIds;

      const response = await fetch(`/api/posts/${postId}/mentions`, {
        body: JSON.stringify({ userIds: filteredUserIds }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to update mentions");
      }
      return response.json();
    },
    onError: (_, __, context) => {
      if (postId && context?.previousPost) {
        updatePostInCaches(
          queryClient,
          postId,
          () => context.previousPost as PostData
        );
      }
    },
    onMutate: async (newUserIds) => {
      if (!postId) {
        return { previousPost: undefined };
      }

      await queryClient.cancelQueries({ queryKey: ["post", postId] });
      const previousPost = queryClient.getQueryData<PostData>(["post", postId]);

      const filteredUserIds = currentUser
        ? newUserIds.filter((id) => id !== currentUser.id)
        : newUserIds;

      const users = filteredUserIds
        .map((id) => queryClient.getQueryData<UserData>(["user", id]))
        .filter((u): u is UserData => !!u);

      updatePostInCaches(queryClient, postId, (post) => ({
        ...post,
        mentions: users.map((user) => ({
          createdAt: new Date(),
          id: `${postId}-${user.id}`,
          postId,
          user,
          userId: user.id,
        })),
      }));

      return { previousPost };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
      queryClient.invalidateQueries({ queryKey: ["mentions"] });
    },
  });
}
