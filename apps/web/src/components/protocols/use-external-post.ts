"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
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

export function useExternalPost(
  uri: string,
  initialPost?: ExternalPost,
  includeDiscussion = true
) {
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
      return initialPost?.id === uri ? initialPost : undefined;
    },
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ uri });
      if (!includeDiscussion) {
        params.set("kind", "post");
      }
      const data = z
        .object({ comments: z.unknown(), post: externalPostSchema.nullable() })
        .parse(
          await readProtocolResource(
            `/api/protocols/bluesky/interactions?${params}`,
            signal
          )
        );
      if (includeDiscussion) {
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
      }
      return data.post;
    },
    queryKey: [
      "external-post",
      uri,
      viewer,
      ...(includeDiscussion ? [] : ["parent"]),
    ],
    retry: false,
    staleTime: 30_000,
  });
}
