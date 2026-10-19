"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useSecondaryFeedReady } from "@/hooks/feed/use-secondary-feed-ready";
import { discoverySuggestionsSchema } from "@/lib/recommendations/suggestion-types";

export function useDiscoverySuggestions(enabled = true, profileId?: string) {
  const { user } = useSession();
  const network = useNetworkSettings();
  const primaryReady = useSecondaryFeedReady();
  const activeProfile =
    profileId ?? network.settings.preferences.activeProfileId;
  return useQuery({
    enabled: enabled && network.ready && primaryReady,
    queryFn: async ({ signal }) => {
      const url = new URL(
        "/api/recommendations/suggestions",
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.origin
      );
      if (activeProfile) {
        url.searchParams.set("profile", activeProfile);
      }
      const response = await fetch(url.toString(), {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error("Couldn't load suggestions");
      }
      return discoverySuggestionsSchema.parse(await response.json());
    },
    queryKey: [
      "discovery-suggestions",
      user?.id ?? "guest",
      network.scope,
      activeProfile,
    ],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
}

export function useSearchLearning() {
  const { user } = useSession();
  const client = useQueryClient();
  return useCallback(
    async (
      query: string,
      author?: { id: string; source: "asm" | "bluesky" }
    ) => {
      if (!user || query.trim().length < 2) {
        return;
      }
      try {
        const response = await fetch("/api/recommendations/search", {
          body: JSON.stringify({
            authorId: author?.id,
            query: query.trim().slice(0, 80),
            source: author?.source,
          }),
          headers: { "content-type": "application/json" },
          keepalive: true,
          method: "POST",
        });
        if (response.ok) {
          window.dispatchEvent(new Event("network:learned"));
          await client.invalidateQueries({
            queryKey: ["discovery-suggestions", user.id],
          });
        }
      } catch {
        // Search learning must never delay opening a result.
      }
    },
    [user, client]
  );
}
