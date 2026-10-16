import { describe, expect, test } from "bun:test";

import {
  conversationCounts,
  conversationName,
  conversationLeft,
  conversationPreview,
} from "./conversation-presentation";
import { peerWatermarks } from "./message-receipts";
import type { MessageConversationData } from "./types";

function conversation(type?: "DM" | "DEN"): MessageConversationData {
  return {
    createdAt: "2026-01-01",
    id: "room",
    keys: [],
    members: ["owner", "peer"].map((userId) => ({
      conversationId: "room",
      lastReadAt: null,
      user: {
        avatarUrl: null,
        badge: null,
        badges: [],
        communityMemberships: [],
        displayName: userId,
        id: userId,
        messageIdentity: null,
        username: userId,
      },
      userId,
    })),
    name: null,
    pairKey: null,
    type,
    updatedAt: "2026-01-01",
  };
}
describe("DM and Den presentation", () => {
  test("legacy cached DM rows retain the peer title and correct filter count", () => {
    const dm = conversation();
    const den = conversation("DEN");
    den.name = " Room name ";
    expect(conversationName(dm, "owner")).toBe("peer");
    expect(conversationName(den, "owner")).toBe("Room name");
    expect(conversationCounts([dm, den])).toEqual({ ALL: 2, DEN: 1, DM: 1 });
  });
  test("Den previews name the sender and keep departed history visible", () => {
    const den = conversation("DEN");
    expect(conversationPreview(den, "owner", "peer", "Hello")).toBe(
      "peer: Hello"
    );
    den.members[0].leftAt = "2026-10-12";
    expect(conversationLeft(den, "owner")).toBe(true);
    expect(conversationPreview(den, "owner", "peer", "Hello")).toBe(
      "You left this den"
    );
  });
  test("a group receipt requires every current recipient, excluding departed members", () => {
    const members = [
      { userId: "owner" },
      { lastDeliveredAt: "2026-01-03", lastReadAt: "2026-01-03", userId: "a" },
      { lastDeliveredAt: "2026-01-02", lastReadAt: null, userId: "b" },
      { lastReadAt: null, leftAt: "2026-01-01", userId: "left" },
    ];
    expect(peerWatermarks(members, "owner")).toEqual({
      deliveredAt: Date.parse("2026-01-02"),
      readAt: null,
    });
    members[2].lastReadAt = "2026-01-02";
    expect(peerWatermarks(members, "owner").readAt).toBe(
      Date.parse("2026-01-02")
    );
  });
});
