import type {
  CommunityChatPermissions,
  CommunityChatRoom,
} from "@asm/messages";
import { queryOptions } from "@tanstack/react-query";

export interface CommunityChatChannelsResponse {
  channels: CommunityChatRoom[];
  permissions: CommunityChatPermissions;
}

export function communityChatChannelsQuery(slug: string, userId?: string) {
  return queryOptions({
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/communities/${slug}/chat/channels`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error("Couldn't load channels.");
      }
      return (await response.json()) as CommunityChatChannelsResponse;
    },
    queryKey: ["community-chat", slug, "channels", userId ?? "guest"],
    staleTime: 15_000,
  });
}
