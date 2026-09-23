import { describe, expect, test } from "bun:test";

import {
  getNotificationTarget,
  notificationHeadlineText,
  presentNotification,
} from "./presenter";
import type { NotificationRecord } from "./types";

function base(
  overrides: Partial<NotificationRecord> & {
    type: NotificationRecord["type"];
  }
): NotificationRecord {
  return {
    comment: null,
    commentId: null,
    community: null,
    communityId: null,
    count: 1,
    createdAt: "2026-09-13T12:00:00.000Z",
    id: "notif-1",
    issuer: {
      avatarUrl: null,
      displayName: "Alice",
      id: "alice",
      username: "alice",
      ...overrides.issuer,
    },
    issuerId: "alice",
    post: {
      community: null,
      content: "Post body",
      id: "post-12345678",
      isGust: false,
      parentPostId: null,
    },
    postId: "post-12345678",
    read: false,
    recipientId: "author-1",
    ...overrides,
  };
}

describe("notification presenter", () => {
  test("names the issuer and the verb for a follow", () => {
    const record = base({ type: "FOLLOW" });
    expect(notificationHeadlineText(record)).toBe("Alice followed you");
  });

  test("uses the eddie noun for a comment amplification", () => {
    const record = base({
      comment: { id: "c1", parent: null, parentId: null },
      commentId: "c1",
      type: "AMPLIFY",
    });
    expect(presentNotification(record).action).toBe("amplified your eddie");
  });

  test("reads a reply to the recipient's eddie differently from a top-level eddie", () => {
    const replyToMe = base({
      comment: { id: "c1", parent: { userId: "author-1" }, parentId: "c0" },
      commentId: "c1",
      type: "COMMENT",
    });
    expect(presentNotification(replyToMe).action).toBe("replied to your eddie");

    const topLevel = base({
      comment: { id: "c1", parent: null, parentId: null },
      commentId: "c1",
      type: "COMMENT",
    });
    expect(presentNotification(topLevel).action).toBe("eddied on your post");
  });

  test("names the community in the action when the post belongs to one", () => {
    const record = base({
      post: {
        community: { slug: "anime" },
        content: "Post body",
        id: "post-12345678",
        isGust: false,
        parentPostId: null,
      },
      type: "MENTION",
    });
    expect(presentNotification(record).action).toBe("mentioned you in a/anime");
  });

  test("folds a batched community post into a count line with no issuer name", () => {
    const record = base({
      community: { id: "comm-1", name: "Anime", slug: "anime" },
      communityId: "comm-1",
      count: 3,
      type: "COMMUNITY_POST",
    });
    expect(notificationHeadlineText(record)).toBe(
      "3 new fleets posted in a/anime"
    );
  });

  test("joins two amplify issuers with 'and'", () => {
    const record = base({
      issuers: undefined,
      type: "AMPLIFY",
    } as Partial<NotificationRecord> & { type: NotificationRecord["type"] });
    const issuers = [
      { avatarUrl: null, displayName: "Alice", id: "alice", username: "alice" },
      { avatarUrl: null, displayName: "Bob", id: "bob", username: "bob" },
    ];
    expect(notificationHeadlineText(record, issuers)).toBe(
      "Alice and Bob amplified your post"
    );
  });

  test("collapses more than three issuers into a '+N others' line", () => {
    const record = base({ type: "AMPLIFY" });
    const issuers = ["Alice", "Bob", "Carol", "Dan"].map((name) => ({
      avatarUrl: null,
      displayName: name,
      id: name.toLowerCase(),
      username: name.toLowerCase(),
    }));
    expect(notificationHeadlineText(record, issuers)).toBe(
      "Alice, Bob and +2 others amplified your post"
    );
  });

  test("routes a post notification to its post target with the comment id", () => {
    const record = base({
      comment: { id: "c9", parent: null, parentId: null },
      commentId: "c9",
      type: "COMMENT",
    });
    expect(getNotificationTarget(record)).toEqual({
      commentId: "c9",
      communitySlug: null,
      isGust: false,
      kind: "post",
      postId: "post-12345678",
    });
  });

  test("routes a batched community post to the community", () => {
    const record = base({
      community: { id: "comm-1", name: "Anime", slug: "anime" },
      communityId: "comm-1",
      count: 2,
      type: "COMMUNITY_POST",
    });
    expect(getNotificationTarget(record)).toEqual({
      kind: "community",
      slug: "anime",
    });
  });

  test("routes a follow to the issuer's profile", () => {
    const record = base({ type: "FOLLOW" });
    expect(getNotificationTarget(record)).toEqual({
      kind: "user",
      username: "alice",
    });
  });

  test("carries the type's badge colors and icon", () => {
    const record = base({ type: "PUBLISHED" });
    const presentation = presentNotification(record);
    expect(presentation.icon).toBe("Sparkles");
    expect(presentation.badge).toEqual({ from: "#34d399", to: "#0d9488" });
  });

  test("falls back to a username when the display name is missing", () => {
    const record = base({
      issuer: {
        avatarUrl: null,
        displayName: null,
        id: "alice",
        username: "alice",
      },
      type: "FOLLOW",
    });
    expect(notificationHeadlineText(record)).toBe("alice followed you");
  });
});
