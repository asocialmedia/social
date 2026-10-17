"use client";

import type { ExternalAuthor } from "@asm/protocols/contracts";
import { externalAuthorSchema } from "@asm/protocols/discovery";
import { useQuery } from "@tanstack/react-query";

export function useBlueskyProfile(actor: string, initialData?: ExternalAuthor) {
  return useQuery({
    enabled: Boolean(actor),
    initialData,
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/protocols/bluesky/profile?${new URLSearchParams({ actor })}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Couldn't load profile");
      }
      return externalAuthorSchema.parse(await response.json());
    },
    queryKey: ["bluesky-profile", actor],
    retry: false,
    staleTime: 60_000,
  });
}
