import { describe, expect, test } from "bun:test";

import type { NotificationData } from "@asm/db";

import { groupNotifications } from "./grouping";

function createMockNotification(
  overrides: Partial<NotificationData> & {
    id: string;
    issuerId: string;
    type: NotificationData["type"];
  }
): NotificationData {
  return {
    comment: null,
    commentId: null,
    createdAt: new Date("2026-09-13T12:00:00.000Z"),
    issuer: {
      avatarUrl: `https://avatars.example.com/${overrides.issuerId}.jpg`,
      displayName: `User ${overrides.issuerId}`,
      id: overrides.issuerId,
      username: overrides.issuerId,
    },
    post: {
      content: "Hello world post",
      id: overrides.postId ?? "post-1",
      isGust: false,
    },
    postId: overrides.postId ?? "post-1",
    read: false,
    recipientId: "author-1",
    ...overrides,
  };
}

describe("notification grouping (groupNotifications in apps/web)", () => {
  test("returns an empty array when given an empty list", () => {
    expect(groupNotifications([])).toEqual([]);
  });

  test("passes through a single notification with issuers and allNotificationIds initialized", () => {
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

  test("groups multiple AMPLIFY notifications for the same post into a single card with all issuers", () => {
    const post1Notif1 = createMockNotification({
      createdAt: new Date("2026-09-13T12:05:00.000Z"),
      id: "notif-1",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const post1Notif2 = createMockNotification({
      createdAt: new Date("2026-09-13T12:10:00.000Z"),
      id: "notif-2",
      issuerId: "bob",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([post1Notif1, post1Notif2]);

    expect(grouped.length).toBe(1);
    const [item] = grouped;
    expect(item?.allNotificationIds).toEqual(["notif-1", "notif-2"]);
    expect(item?.issuers.map((u) => u.id)).toEqual(["alice", "bob"]);
    expect(item?.createdAt.toISOString()).toBe("2026-09-13T12:10:00.000Z");
  });

  test("groups 6 amplifications for the same post (supporting +4 count pattern)", () => {
    const users = ["alice", "bob", "charlie", "david", "eve", "frank"];
    const notifs = users.map((user, idx) =>
      createMockNotification({
        createdAt: new Date(`2026-09-13T12:0${idx}:00.000Z`),
        id: `notif-${idx + 1}`,
        issuerId: user,
        postId: "post-hot",
        type: "AMPLIFY",
      })
    );

    const grouped = groupNotifications(notifs);

    expect(grouped.length).toBe(1);
    const [card] = grouped;
    expect(card?.allNotificationIds.length).toBe(6);
    expect(card?.issuers.length).toBe(6);
    expect(card?.issuers[0]?.id).toBe("alice");
    expect(card?.issuers[1]?.id).toBe("bob");
    expect(card?.issuers.length - 2).toBe(4);
  });

  test("groups AMPLIFY notifications on eddies (comments) by commentId", () => {
    const eddie1Notif1 = createMockNotification({
      comment: {
        content: "funny comment",
        id: "comment-1",
      },
      commentId: "comment-1",
      id: "notif-c1",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const eddie1Notif2 = createMockNotification({
      comment: {
        content: "funny comment",
        id: "comment-1",
      },
      commentId: "comment-1",
      id: "notif-c2",
      issuerId: "bob",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([eddie1Notif1, eddie1Notif2]);

    expect(grouped.length).toBe(1);
    expect(grouped[0]?.issuers.map((u) => u.id)).toEqual(["alice", "bob"]);
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-c1", "notif-c2"]);
  });

  test("does not group non-AMPLIFY notifications even if on the same post", () => {
    const commentNotif = createMockNotification({
      id: "notif-comment",
      issuerId: "alice",
      postId: "post-1",
      type: "COMMENT",
    });

    const mentionNotif = createMockNotification({
      id: "notif-mention",
      issuerId: "bob",
      postId: "post-1",
      type: "MENTION",
    });

    const grouped = groupNotifications([commentNotif, mentionNotif]);

    expect(grouped.length).toBe(2);
    expect(grouped[0]?.id).toBe("notif-comment");
    expect(grouped[1]?.id).toBe("notif-mention");
  });

  test("marks grouped notification as unread (read: false) if any notification is unread", () => {
    const readNotif = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      postId: "post-1",
      read: true,
      type: "AMPLIFY",
    });

    const unreadNotif = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      postId: "post-1",
      read: false,
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([readNotif, unreadNotif]);

    expect(grouped.length).toBe(1);
    expect(grouped[0]?.read).toBe(false);
  });
});
