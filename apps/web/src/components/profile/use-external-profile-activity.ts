"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { externalProfileActivityPageSchema } from "@/lib/protocols/profile-activity-schema";
import { readProtocolResource } from "@/lib/protocols/read-resource";

type ActivityPage = z.infer<typeof externalProfileActivityPageSchema>;

export function useExternalProfileActivity(
  userId: string,
  kind: "amplified" | "eddies"
) {
  const { user } = useSession();
  const network = useNetworkSettings();
  return useInfiniteQuery({
    enabled: Boolean(user) && network.ready,
    getNextPageParam: (page: ActivityPage) => page.nextCursor,
    initialPageParam: null as ActivityPage["nextCursor"],
    queryFn: async ({ pageParam, signal }): Promise<ActivityPage> => {
      const query = new URLSearchParams({ kind });
      if (pageParam) {
        query.set("cursor", JSON.stringify(pageParam));
      }
      return externalProfileActivityPageSchema.parse(
        await readProtocolResource(
          `/api/users/${encodeURIComponent(userId)}/external-activity?${query}`,
          signal
        )
      );
    },
    queryKey: [
      "profile-external-activity",
      userId,
      kind,
      user?.id ?? "guest",
      network.scope,
    ],
    staleTime: 60_000,
  });
}
