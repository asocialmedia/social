import { clientLog } from "@asm/config/debug";
import type { Tag } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

interface TagResponse {
  tags: string[];
}

interface PopularTagsResponse {
  tags: Tag[];
}

export function useTags(postId?: string) {
  const queryClient = useQueryClient();

  const { data: popularTags } = useQuery<PopularTagsResponse>({
    queryFn: async () => {
      const res = await fetch("/api/tags/popular");
      if (!res.ok) {
        return { tags: [] };
      }
      return res.json();
    },
    queryKey: ["popularTags"],
  });

  const { data: suggestions } = useQuery<TagResponse>({
    enabled: false,
    queryFn: async () => {
      const res = await fetch("/api/tags");
      if (!res.ok) {
        return { tags: [] };
      }
      return res.json();
    },
    queryKey: ["tagSuggestions"],
  });

  const searchTags = useCallback(
    async (query: string) => {
      try {
        if (!query.trim()) {
          queryClient.setQueryData(["tagSuggestions"], { tags: [] });
          return;
        }
        const res = await fetch(`/api/tags?q=${encodeURIComponent(query)}`);
        if (!res.ok) {
          throw new Error("Failed to fetch tags");
        }
        const data = await res.json();
        queryClient.setQueryData(["tagSuggestions"], data);
        return data;
      } catch (error) {
        clientLog.error("Error searching tags:", error);
        return { tags: [] };
      }
    },
    [queryClient]
  );

  const updateTags = useMutation({
    mutationFn: async (tags: string[]) => {
      if (!postId) {
        return { tags: tags.map((tag) => ({ name: tag })) };
      }

      const res = await fetch(`/api/posts/${postId}/tags`, {
        body: JSON.stringify({ tags }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to update tags");
      }
      return res.json();
    },

    onError: (context: { previousTags?: unknown } | undefined) => {
      if (postId && context?.previousTags) {
        queryClient.setQueryData(["post", postId], context.previousTags);
      }
    },
    onMutate: async (newTags) => {
      await queryClient.cancelQueries({ queryKey: ["post", postId] });
      await queryClient.cancelQueries({ queryKey: ["popularTags"] });

      const previousTags = queryClient.getQueryData(["post", postId]);

      if (postId) {
        queryClient.setQueryData(["post", postId], (old: unknown) => ({
          ...(typeof old === "object" && old !== null ? old : {}),
          tags: newTags.map((tag) => ({ id: tag, name: tag })),
        }));
      }

      return { previousTags };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      queryClient.invalidateQueries({ queryKey: ["popularTags"] });
    },
  });

  return {
    popularTags: popularTags?.tags ?? [],
    searchTags,
    suggestions: suggestions?.tags ?? [],
    updateTags,
  };
}
