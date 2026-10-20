"use client";

import {
  externalCommentPageSchema,
  externalPostSchema,
} from "@asm/protocols/discovery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import {
  cachedExternalPost,
  isExternalViewerQuery,
} from "@/lib/protocols/external-cache";
import { readProtocolResource } from "@/lib/protocols/read-resource";

export function useExternalPost(uri: string) {
  const { user } = useSession();
  const viewer = user?.id ?? "guest";
  const client = useQueryClient();
  return useQuery({
    enabled: Boolean(uri),
    initialData: () => {
      for (const [, data] of client.getQueriesData({
        predicate: ({ queryKey }) => isExternalViewerQuery(queryKey, viewer),
      })) {
        const post = cachedExternalPost(data, uri);
        if (post) {
          return post;
        }
      }
    },
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      const data = z
        .object({ comments: z.unknown(), post: z.unknown() })
        .parse(
          await readProtocolResource(
            `/api/protocols/bluesky/interactions?${new URLSearchParams({ uri })}`,
            signal
          )
        );
      const comments = externalCommentPageSchema.parse(data.comments);
      // Seed the first discussion page without replacing an already paginated thread.
      client.setQueryData(
        ["external-discussion", uri],
        (current: unknown) =>
          current ?? {
            pageParams: [null],
            pages: [comments],
          }
      );
      return data.post === null ? null : externalPostSchema.parse(data.post);
    },
    queryKey: ["external-post", uri, viewer],
    retry: false,
    staleTime: 30_000,
  });
}
