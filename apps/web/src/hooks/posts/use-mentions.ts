import type { UserData } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface MentionsResponse {
  mentions: UserData[];
}

export function useMentions(postId?: string) {
  const queryClient = useQueryClient();

  const { data: mentions } = useQuery<MentionsResponse>({
    enabled: !!postId,
    queryFn: async () => {
      if (!postId) {
        return { mentions: [] };
      }
      const res = await fetch(`/api/posts/${postId}/mentions`);
      if (!res.ok) {
        return { mentions: [] };
      }
      return res.json();
    },
    queryKey: ["mentions", postId],
  });

  const updateMentions = useMutation({
    mutationFn: async (newMentions: UserData[]) => {
      if (!postId) {
        return { mentions: newMentions };
      }

      const res = await fetch(`/api/posts/${postId}/mentions`, {
        body: JSON.stringify({ mentions: newMentions.map((m) => m.id) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to update mentions");
      }
      return res.json();
    },

    onError: (context: { previousMentions?: unknown } | undefined) => {
      if (postId && context?.previousMentions) {
        queryClient.setQueryData(
          ["mentions", postId],
          context.previousMentions
        );
      }
    },

    onMutate: async (newMentions) => {
      await queryClient.cancelQueries({ queryKey: ["mentions", postId] });
      const previousMentions = queryClient.getQueryData(["mentions", postId]);

      if (postId) {
        queryClient.setQueryData(["mentions", postId], {
          mentions: newMentions,
        });
      }

      return { previousMentions };
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["mentions", postId] });
    },
  });

  return {
    mentions: mentions?.mentions ?? [],
    updateMentions,
  };
}
