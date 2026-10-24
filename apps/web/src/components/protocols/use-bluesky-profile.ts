"use client";

import type { ExternalAuthor } from "@asm/protocols/contracts";
import { externalAuthorSchema } from "@asm/protocols/discovery";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { cachedExternalAuthor } from "@/lib/protocols/external-cache";
import { readProtocolResource } from "@/lib/protocols/read-resource";

export function useBlueskyProfile(
  actor: string,
  initialData?: ExternalAuthor,
  enabled = true
) {
  const client = useQueryClient();
  return useQuery({
    enabled: Boolean(actor) && enabled,
    initialData: () => {
      if (initialData) {
        return initialData;
      }
      for (const [, data] of client.getQueriesData({})) {
        const author = cachedExternalAuthor(data, actor);
        if (author) {
          return author;
        }
      }
    },
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      const data = await readProtocolResource(
        `/api/protocols/bluesky/profile?${new URLSearchParams({ actor })}`,
        signal
      );
      return externalAuthorSchema.parse(data);
    },
    queryKey: ["bluesky-profile", actor],
    retry: false,
    staleTime: 60_000,
  });
}
