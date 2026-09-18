import { describe, expect, test } from "bun:test";

import type { NotificationData } from "../client";
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
      community: null,
      content: "Hello world post",
      id: overrides.postId ?? "post-1",
      isGust: false,
      parentPostId: null,
    },
    postId: overrides.postId ?? "post-1",
    read: false,
    recipientId: "author-1",
    ...overrides,
  };
}

describe("notification grouping (groupNotifications)", () => {
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
      createdAt: new Date("2026-09-13T12:03:00.000Z"),
      id: "notif-2",
      issuerId: "bob",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([post1Notif1, post1Notif2]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.id).toBe("notif-1");
    expect(grouped[0]?.postId).toBe("post-1");
    expect(grouped[0]?.issuers.map((u) => u.id)).toEqual(["alice", "bob"]);
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1", "notif-2"]);
    expect(grouped[0]?.createdAt).toEqual(new Date("2026-09-13T12:05:00.000Z"));
  });

  test("groups 6 amplifications for the same post (supporting +4 count pattern)", () => {
    const users = ["alice", "bob", "charlie", "david", "eve", "frank"];
    const notifs = users.map((username, index) =>
      createMockNotification({
        createdAt: new Date(`2026-09-13T12:0${6 - index}:00.000Z`),
        id: `notif-${index + 1}`,
        issuerId: username,
        postId: "popular-post",
        type: "AMPLIFY",
      })
    );

    const grouped = groupNotifications(notifs);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.issuers.length).toBe(6);
    expect(grouped[0]?.issuers.map((u) => u.id)).toEqual(users);
    expect(grouped[0]?.allNotificationIds.length).toBe(6);
  });

  test("keeps amplifications of different posts in separate groups", () => {
    const post1Amplify = createMockNotification({
      createdAt: new Date("2026-09-13T12:05:00.000Z"),
      id: "notif-1",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });
    const post2Amplify = createMockNotification({
      createdAt: new Date("2026-09-13T12:04:00.000Z"),
      id: "notif-2",
      issuerId: "bob",
      postId: "post-2",
      type: "AMPLIFY",
    });
    const post1Amplify2 = createMockNotification({
      createdAt: new Date("2026-09-13T12:02:00.000Z"),
      id: "notif-3",
      issuerId: "charlie",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([
      post1Amplify,
      post2Amplify,
      post1Amplify2,
    ]);

    // Should result in 2 items: Post 1 group (Alice, Charlie) and Post 2 group (Bob)
    expect(grouped.length).toBe(2);
    expect(grouped[0]?.postId).toBe("post-1");
    expect(grouped[0]?.issuers.map((u) => u.id)).toEqual(["alice", "charlie"]);
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1", "notif-3"]);

    expect(grouped[1]?.postId).toBe("post-2");
    expect(grouped[1]?.issuers.map((u) => u.id)).toEqual(["bob"]);
    expect(grouped[1]?.allNotificationIds).toEqual(["notif-2"]);
  });

  test("groups AMPLIFY notifications on eddies (comments) by commentId", () => {
    const eddieAmplify1 = createMockNotification({
      comment: {
        id: "comment-1",
        parent: null,
        parentId: null,
      },
      commentId: "comment-1",
      createdAt: new Date("2026-09-13T12:05:00.000Z"),
      id: "notif-eddie-1",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });
    const eddieAmplify2 = createMockNotification({
      comment: {
        id: "comment-1",
        parent: null,
        parentId: null,
      },
      commentId: "comment-1",
      createdAt: new Date("2026-09-13T12:03:00.000Z"),
      id: "notif-eddie-2",
      issuerId: "bob",
      postId: "post-1",
      type: "AMPLIFY",
    });
    const postAmplify = createMockNotification({
      createdAt: new Date("2026-09-13T12:01:00.000Z"),
      id: "notif-post",
      issuerId: "charlie",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([
      eddieAmplify1,
      eddieAmplify2,
      postAmplify,
    ]);

    // Should produce 2 distinct groups: comment-1 amplify group and post-1 amplify group
    expect(grouped.length).toBe(2);
    expect(grouped[0]?.commentId).toBe("comment-1");
    expect(grouped[0]?.issuers.map((u) => u.id)).toEqual(["alice", "bob"]);
    expect(grouped[1]?.commentId).toBeNull();
    expect(grouped[1]?.postId).toBe("post-1");
    expect(grouped[1]?.issuers.map((u) => u.id)).toEqual(["charlie"]);
  });

  test("does not group non-AMPLIFY notifications even if on the same post", () => {
    const postAmplify = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });
    const postComment = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      postId: "post-1",
      type: "COMMENT",
    });
    const postMention = createMockNotification({
      id: "notif-3",
      issuerId: "charlie",
      postId: "post-1",
      type: "MENTION",
    });
    const followNotif = createMockNotification({
      id: "notif-4",
      issuerId: "david",
      postId: null,
      type: "FOLLOW",
    });

    const grouped = groupNotifications([
      postAmplify,
      postComment,
      postMention,
      followNotif,
    ]);

    expect(grouped.length).toBe(4);
    expect(grouped.map((g) => g.type)).toEqual([
      "AMPLIFY",
      "COMMENT",
      "MENTION",
      "FOLLOW",
    ]);
  });

  test("deduplicates issuers if the same user amplified multiple times", () => {
    const notif1 = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });
    const notif2 = createMockNotification({
      id: "notif-2",
      issuerId: "alice",
      postId: "post-1",
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([notif1, notif2]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.issuers.length).toBe(1);
    expect(grouped[0]?.issuers[0]?.id).toBe("alice");
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1", "notif-2"]);
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

  test("marks grouped notification as read (read: true) only if all notifications are read", () => {
    const readNotif1 = createMockNotification({
      id: "notif-1",
      issuerId: "alice",
      postId: "post-1",
      read: true,
      type: "AMPLIFY",
    });
    const readNotif2 = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      postId: "post-1",
      read: true,
      type: "AMPLIFY",
    });

    const grouped = groupNotifications([readNotif1, readNotif2]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.read).toBe(true);
  });
});
