import { discoverySuggestionsSchema } from "@asm/protocols/discovery";

import { networkRequest } from "../lib/network-api";
import {
  useNetworkSettings,
  refreshNetworkSettings,
} from "./use-network-settings";
import {
  invalidateProtocolResources,
  useProtocolResource,
} from "./use-protocol-resource";

export function useDiscoverySuggestions(enabled = true) {
  const network = useNetworkSettings();
  const query = useProtocolResource(
    `discovery-suggestions:${network.viewer}:${network.scope}`,
    async (signal) =>
      discoverySuggestionsSchema.parse(
        await networkRequest(
          `/api/recommendations/suggestions?${new URLSearchParams({ profile: network.settings.preferences.activeProfileId })}`,
          { signal }
        )
      ),
    enabled && network.ready
  );
  return { ...query, network };
}

export async function learnNetworkSearch(
  viewer: string,
  query: string,
  author?: { id: string; source: "asm" | "bluesky" }
) {
  if (viewer === "guest" || query.trim().length < 2) {
    return;
  }
  try {
    await networkRequest("/api/recommendations/search", {
      body: JSON.stringify({
        authorId: author?.id,
        query: query.trim().slice(0, 80),
        source: author?.source,
      }),
      method: "POST",
    });
    invalidateProtocolResources(`discovery-suggestions:${viewer}:`);
    void refreshNetworkSettings(viewer, true);
  } catch {
    // Learning never delays opening a search result.
  }
}
