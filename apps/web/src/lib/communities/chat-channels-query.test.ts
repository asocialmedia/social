import { expect, test } from "bun:test";

import type { CommunityChatRoom } from "@asm/messages";
import { QueryClient } from "@tanstack/react-query";

import {
  cacheCommunityChatChannel,
  communityChatChannelsQuery,
} from "./chat-channels-query";

function channel(id: string, sortOrder: number): CommunityChatRoom {
  return {
    archived: false,
    changeSequence: "0",
    channelType: "TEXT",
    id,
    kind: "CHANNEL",
    locked: false,
    name: id,
    nextSequence: "0",
    parentRoomId: null,
    slowModeSeconds: 0,
    slug: id,
    sortOrder,
    topic: null,
    visibility: "PUBLIC",
  };
}

test("channel creation, settings, and archival update the fresh Posts cache for the same viewer", async () => {
  const client = new QueryClient();
  const staff = communityChatChannelsQuery("table", "staff");
  const guest = communityChatChannelsQuery("table");
  const existing = {
    channels: [channel("general", 0)],
    permissions: {
      canManage: true,
      canRead: true,
      canSend: true,
      isMember: true,
    },
  };
  const guestData = {
    ...existing,
    permissions: { ...existing.permissions, canManage: false },
  };
  client.setQueryData(staff.queryKey, existing);
  client.setQueryData(guest.queryKey, guestData);
  const staleResponse = Promise.withResolvers<typeof existing>();
  let staleSignal: AbortSignal | undefined;
  const staleRefetch = client.fetchQuery({
    ...staff,
    queryFn: ({ signal }) => {
      staleSignal = signal;
      return staleResponse.promise;
    },
    staleTime: 0,
  });
  try {
    const created = channel("updates", 1);
    await cacheCommunityChatChannel(client, staff.queryKey, created);
    staleResponse.resolve(existing);
    await staleRefetch;
    expect(staleSignal?.aborted).toBe(true);
    expect(client.getQueryData(staff.queryKey)).toEqual({
      ...existing,
      channels: [...existing.channels, created],
    });

    const updated = { ...created, name: "News", sortOrder: -1 };
    await cacheCommunityChatChannel(client, staff.queryKey, updated);
    expect(client.getQueryData(staff.queryKey)?.channels).toEqual([
      updated,
      ...existing.channels,
    ]);

    await cacheCommunityChatChannel(client, staff.queryKey, {
      ...updated,
      archived: true,
    });
    expect(client.getQueryData(staff.queryKey)).toEqual(existing);
    expect(client.getQueryData(guest.queryKey)).toEqual(guestData);
  } finally {
    client.clear();
  }
});
