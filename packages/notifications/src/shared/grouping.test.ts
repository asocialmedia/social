import { describe, expect, test } from "bun:test";

import { groupNotifications } from "./grouping";
import type { NotificationRecord } from "./types";

function createMockNotification(
  overrides: Partial<NotificationRecord> & {
    id: string;
    issuerId: string;
    type: NotificationRecord["type"];
  }
): NotificationRecord {
  const { id, issuerId, type, ...rest } = overrides;
  return {
    comment: null,
    commentId: null,
    community: null,
    communityId: null,
    count: 1,
    createdAt: "2026-09-13T12:00:00.000Z",
    id,
    issuer: {
      avatarUrl: `https://avatars.example.com/${issuerId}.jpg`,
      displayName: `User ${issuerId}`,
      id: issuerId,
      username: issuerId,
    },
    issuerId,
    post: {
      community: null,
      content: "Hello world post",
      id: overrides.postId ?? "post-1",
      isGust: false,
      parentPostId: null,
    },
    postId: overrides.postId ?? "post-1",
    read: false,
    recipientId: "author-1",
    type,
    ...rest,
  };
}

describe("notification grouping", () => {
  test("returns an empty array for an empty list", () => {
    expect(groupNotifications([])).toEqual([]);
  });

  test("passes a single notification through with issuers and ids initialized", () => {
    const notif = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      type: "AMPLIFY",
    });
    const grouped = groupNotifications([notif]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.id).toBe("notif-1");
    expect(grouped[0]?.issuers).toEqual([notif.issuer]);
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1"]);
  });

  test("folds multiple amplifies of the same post into one row with all issuers", () => {
    const first = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      type: "AMPLIFY",
    });
    const second = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      type: "AMPLIFY",
    });
    const grouped = groupNotifications([first, second]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1", "notif-2"]);
    expect(grouped[0]?.issuers.map((issuer) => issuer.id)).toEqual([
      "alice",
      "bob",
    ]);
  });

  test("deduplicates an issuer who amplifies twice", () => {
    const first = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      type: "AMPLIFY",
    });
    const second = createMockNotification({
      id: "notif-2",
      issuerId: "alice",
      type: "AMPLIFY",
    });
    const grouped = groupNotifications([first, second]);
    expect(grouped[0]?.issuers.length).toBe(1);
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1", "notif-2"]);
  });

  test("keeps a group unread when any member is unread", () => {
    const read = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      read: true,
      type: "AMPLIFY",
    });
    const unread = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      read: false,
      type: "AMPLIFY",
    });
    const grouped = groupNotifications([read, unread]);
    expect(grouped[0]?.read).toBe(false);
  });

  test("keeps the newest createdAt in a group across Date and string inputs", () => {
    const older = createMockNotification({
      createdAt: "2026-09-13T12:00:00.000Z",
      id: "notif-1",
      issuerId: "alice",
      type: "AMPLIFY",
    });
    const newer = createMockNotification({
      createdAt: new Date("2026-09-14T12:00:00.000Z"),
      id: "notif-2",
      issuerId: "bob",
      type: "AMPLIFY",
    });
    const grouped = groupNotifications([older, newer]);
    expect(new Date(grouped[0]?.createdAt ?? 0).toISOString()).toBe(
      "2026-09-14T12:00:00.000Z"
    );
  });

  test("groups comment amplifies by commentId, not postId", () => {
    const commentAmplify = createMockNotification({
      comment: { id: "comment-1", parent: null, parentId: null },
      commentId: "comment-1",
      id: "notif-1",
      issuerId: "alice",
      type: "AMPLIFY",
    });
    const postAmplify = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      type: "AMPLIFY",
    });
    const grouped = groupNotifications([commentAmplify, postAmplify]);
    // Same postId, but one is a comment amplify: two distinct groups.
    expect(grouped.length).toBe(2);
  });

  test("does not group non-AMPLIFY types", () => {
    const follow = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      type: "FOLLOW",
    });
    const mention = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      type: "MENTION",
    });
    const grouped = groupNotifications([follow, mention]);
    expect(grouped.length).toBe(2);
  });
});
