import type {
  CommunityChatPermissions,
  CommunityChatRoom,
} from "@asm/messages";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export interface CommunityChatChannelsResponse {
  channels: CommunityChatRoom[];
  permissions: CommunityChatPermissions;
}

export class CommunityChatChannelsError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Couldn't load channels.");
    this.name = "CommunityChatChannelsError";
    this.status = status;
  }
}

export function communityChatChannelsQuery(slug: string, userId?: string) {
  return queryOptions({
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/communities/${slug}/chat/channels`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new CommunityChatChannelsError(response.status);
      }
      return (await response.json()) as CommunityChatChannelsResponse;
    },
    queryKey: ["community-chat", slug, "channels", userId ?? "guest"],
    staleTime: 15_000,
  });
}

export async function cacheCommunityChatChannel(
  client: QueryClient,
  queryKey: ReturnType<typeof communityChatChannelsQuery>["queryKey"],
  channel: CommunityChatRoom
) {
  await client.cancelQueries({ exact: true, queryKey });
  const data = client.setQueryData(queryKey, (current) => {
    if (!current) {
      return current;
    }
    const channels = current.channels.filter(({ id }) => id !== channel.id);
    if (!channel.archived) {
      channels.push(channel);
    }
    return {
      ...current,
      channels: channels.toSorted(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name)
      ),
    };
  });
  if (!data) {
    await client.invalidateQueries({ exact: true, queryKey });
  }
}
