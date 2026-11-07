import { describe, expect, test } from "bun:test";

import type { CommunityChatRoom } from "@asm/messages";

import { buildCommunityChannelShortcuts } from "./community-channel-shortcuts";

function room(
  overrides: Partial<CommunityChatRoom> & { id: string }
): CommunityChatRoom {
  return {
    archived: false,
    channelType: "TEXT",
    locked: false,
    name: overrides.id,
    parentRoomId: null,
    sortOrder: 0,
    topic: null,
    visibility: "PUBLIC",
    ...overrides,
  } as CommunityChatRoom;
}

describe("community channel shortcuts", () => {
  test("sorts by position and flags announcement channels as staff", () => {
    const shortcuts = buildCommunityChannelShortcuts("hackers", [
      room({
        channelType: "ANNOUNCEMENT",
        id: "b",
        name: "news",
        sortOrder: 2,
      }),
      room({ id: "a", name: "general", sortOrder: 1 }),
    ]);
    expect(shortcuts.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(shortcuts[0]).toMatchObject({
      href: "/a/hackers/chat/a",
      staff: false,
    });
    expect(shortcuts[1]).toMatchObject({
      href: "/a/hackers/chat/b",
      staff: true,
    });
  });
});
