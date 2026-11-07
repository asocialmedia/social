// Pure shortcut-list builder behind CommunityChannelShortcuts, ported from
// web's community-channel-shortcuts.tsx
// (apps/web/src/components/communities/page/community-channel-shortcuts.tsx).
// Web lists every channel with an announcement ("Staff") flag and a count;
// the shape/ordering rules live here so they are unit-testable.
import type { CommunityChatRoom } from "@asm/messages";

export interface CommunityChannelShortcut {
  channelType: CommunityChatRoom["channelType"];
  href: `/a/${string}`;
  id: string;
  name: string;
  staff: boolean;
}

export function buildCommunityChannelShortcuts(
  slug: string,
  channels: readonly CommunityChatRoom[]
): CommunityChannelShortcut[] {
  return (
    [...channels]
      .slice()
      // oxlint-disable-next-line unicorn/no-array-sort -- Device Hermes predates ES2023 toSorted (TypeError on device); sort runs on a fresh spread copy.
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((channel) => ({
        channelType: channel.channelType,
        href: `/a/${slug}/chat/${channel.id}`,
        id: channel.id,
        name: channel.name,
        staff: channel.channelType === "ANNOUNCEMENT",
      }))
  );
}
