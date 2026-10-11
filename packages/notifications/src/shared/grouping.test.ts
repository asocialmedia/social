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
    conversation: null,
    conversationId: null,
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

// A den message row. The den is the only thing two such rows can share.
function denMessage(
  overrides: Partial<NotificationRecord> & {
    id: string;
    issuerId: string;
  }
): NotificationRecord {
  return createMockNotification({
    conversation: { id: "den-1", name: "Study group" },
    conversationId: "den-1",
    type: "DEN_MESSAGE",
    ...overrides,
  });
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

describe("grouping den messages", () => {
  test("folds siblings in the same den into one row", () => {
    const first = denMessage({ id: "notif-1", issuerId: "alice" });
    const second = denMessage({ id: "notif-2", issuerId: "bob" });
    const grouped = groupNotifications([first, second]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.id).toBe("notif-1");
    expect(grouped[0]?.issuers.map((issuer) => issuer.id)).toEqual([
      "alice",
      "bob",
    ]);
    // Every id is kept, so dismissing the row deletes both rows.
    expect(grouped[0]?.allNotificationIds).toEqual(["notif-1", "notif-2"]);
  });

  test("sums the counts, so the row reports the messages it stands for", () => {
    // The write side folds into one row carrying count 12; the read side has to
    // add up too, or a read-then-unread pair would read as "1 new message".
    const read = denMessage({
      count: 12,
      id: "notif-1",
      issuerId: "alice",
      read: true,
    });
    const unread = denMessage({
      count: 1,
      id: "notif-2",
      issuerId: "bob",
      read: false,
    });
    const grouped = groupNotifications([unread, read]);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.count).toBe(13);
    expect(grouped[0]?.read).toBe(false);
  });

  test("keeps two different dens apart", () => {
    const studyGroup = denMessage({ id: "notif-1", issuerId: "alice" });
    const gameNight = denMessage({
      conversation: { id: "den-2", name: "Game night" },
      conversationId: "den-2",
      id: "notif-2",
      issuerId: "alice",
    });
    const grouped = groupNotifications([studyGroup, gameNight]);
    expect(grouped.length).toBe(2);
    expect(grouped[0]?.conversation?.name).toBe("Study group");
    expect(grouped[1]?.conversation?.name).toBe("Game night");
  });

  test("folds a hundred messages in one den into a single row", () => {
    const messages = Array.from({ length: 100 }, (_, index) =>
      denMessage({ id: `notif-${index}`, issuerId: "alice" })
    );
    const grouped = groupNotifications(messages);
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.allNotificationIds).toHaveLength(100);
    // One sender repeated a hundred times is one avatar, not a hundred.
    expect(grouped[0]?.issuers).toHaveLength(1);
    expect(grouped[0]?.count).toBe(100);
  });

  test("does not fold a den message into a non-den row that shares its post", () => {
    // The den fixture carries a postId, because the base row has one. If the
    // fold key leaked onto postId, a den message would swallow an amplify of
    // the same post.
    const den = denMessage({ id: "notif-1", issuerId: "alice" });
    const amplify = createMockNotification({
      id: "notif-2",
      issuerId: "bob",
      type: "AMPLIFY",
    });
    expect(groupNotifications([den, amplify]).length).toBe(2);
  });

  test("leaves a den row with no conversation unfolded", () => {
    const orphan = createMockNotification({
      conversation: null,
      conversationId: null,
      id: "notif-1",
      issuerId: "alice",
      type: "DEN_MESSAGE",
    });
    const same = createMockNotification({
      conversation: null,
      conversationId: null,
      id: "notif-2",
      issuerId: "bob",
      type: "DEN_MESSAGE",
    });
    const grouped = groupNotifications([orphan, same]);
    expect(grouped.length).toBe(2);
    expect(grouped[0]?.count).toBe(1);
  });
});
