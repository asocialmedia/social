import { describe, expect, test } from "bun:test";

import {
  getNotificationTarget,
  notificationDenName,
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
    conversation: null,
    conversationId: null,
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

// A den message row: the den is named, and nothing else about it is present.
function denMessage(
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord {
  return base({
    conversation: { id: "den-1", name: "Study group" },
    conversationId: "den-1",
    type: "DEN_MESSAGE",
    ...overrides,
  });
}

// A membership that ended with the den still standing. The conversation is named,
// so the copy can be specific about which room.
function membershipEndedRemoved(
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord {
  return base({
    conversation: { id: "den-1", name: "Study group" },
    conversationId: "den-1",
    type: "DEN_MEMBERSHIP_ENDED",
    ...overrides,
  });
}

// A membership that ended because the den was dissolved. No conversation at all:
// the den row is gone, and so is anything that pointed at it.
function membershipEndedDissolved(
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord {
  return base({
    conversation: null,
    conversationId: null,
    type: "DEN_MEMBERSHIP_ENDED",
    ...overrides,
  });
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

describe("a den message names the room as well as the sender", () => {
  test("reads 'Alice in Study group: sent a message'", () => {
    expect(notificationHeadlineText(denMessage())).toBe(
      "Alice in Study group: sent a message"
    );
  });

  test("splits the sender, the room and the verb into their own runs", () => {
    // The room is a name, so it renders in the same ink as the sender's. It is
    // the run between "in " and ": " that a reader scans for when the inbox is
    // full, so it must not be folded into the muted verb phrase.
    expect(presentNotification(denMessage()).headline).toEqual([
      { emphasis: "name", text: "Alice" },
      { emphasis: "action", text: " in " },
      { emphasis: "name", text: "Study group" },
      { emphasis: "action", text: ": sent a message" },
    ]);
  });

  test("carries the den's name in the action, which is the push body", () => {
    expect(presentNotification(denMessage()).action).toBe(
      "sent a message in Study group"
    );
  });

  test("counts a folded den into the message total", () => {
    expect(notificationHeadlineText(denMessage({ count: 12 }))).toBe(
      "Alice in Study group: 12 new messages"
    );
    expect(presentNotification(denMessage({ count: 12 })).action).toBe(
      "12 new messages in Study group"
    );
  });

  test("names the senders of a folded den before the room", () => {
    const issuers = ["Alice", "Bob", "Carol", "Dan"].map((name) => ({
      avatarUrl: null,
      displayName: name,
      id: name.toLowerCase(),
      username: name.toLowerCase(),
    }));
    expect(notificationHeadlineText(denMessage({ count: 4 }), issuers)).toBe(
      "Alice, Bob and +2 others in Study group: 4 new messages"
    );
  });

  test("joins two senders with 'and' inside a den", () => {
    const issuers = [
      { avatarUrl: null, displayName: "Alice", id: "alice", username: "alice" },
      { avatarUrl: null, displayName: "Bob", id: "bob", username: "bob" },
    ];
    expect(notificationHeadlineText(denMessage(), issuers)).toBe(
      "Alice and Bob in Study group: sent a message"
    );
  });

  test("falls back to a generic room rather than an empty one", () => {
    // A den name is required by the schema, so this is the unreachable branch
    // kept total instead of asserted.
    const record = denMessage({ conversation: { id: "den-1", name: null } });
    expect(notificationHeadlineText(record)).toBe(
      "Alice in a den: sent a message"
    );
  });

  test("names the den in a removal, because the den is still there", () => {
    // A removal is the case where the conversation survives, so the row points at
    // it and the copy can name it. The reader is no longer a member, so the target
    // is still nowhere - but the sentence still says which room it was.
    expect(notificationHeadlineText(membershipEndedRemoved())).toBe(
      "Alice removed you from Study group"
    );
    expect(presentNotification(membershipEndedRemoved()).action).toBe(
      "removed you from Study group"
    );
  });

  test("cannot name a den in a dissolve, because there is none left", () => {
    // The dissolve row carries no conversation - the foreign key would cascade it
    // away with the den it was announcing - so the sentence has to be one that
    // survives its own subject. Naming a room here would be printing something
    // the row does not carry.
    expect(notificationHeadlineText(membershipEndedDissolved())).toBe(
      "Alice deleted a den you were in"
    );
  });

  test("renders a membership that ended in the plain issuer-then-action shape", () => {
    // Spelled out rather than left to the default, so a later branch here cannot
    // quietly change this row into a den-message headline with an empty room.
    expect(presentNotification(membershipEndedDissolved()).headline).toEqual([
      { emphasis: "name", text: "Alice" },
      { emphasis: "action", text: " deleted a den you were in" },
    ]);
  });

  test("a membership that ended goes nowhere, and never to a post", () => {
    // The recipient is not a member of the den any more, so the thread is closed
    // to them, and a dissolve has no thread at all. Pointing at either would be a
    // tap that lands on a 404. The base fixture still carries a postId, which is
    // the exact thing a fall-through would have used.
    expect(getNotificationTarget(membershipEndedRemoved())).toEqual({
      kind: "none",
    });
    expect(getNotificationTarget(membershipEndedDissolved())).toEqual({
      kind: "none",
    });
  });

  test("a membership that ended looks nothing like a message in the same den", () => {
    // Same room, same icon family, deliberately different colour: a reader
    // scanning the inbox should not read a removal as another message arriving.
    const removed = presentNotification(membershipEndedRemoved());
    const message = presentNotification(denMessage());
    expect(removed.badge).not.toEqual(message.badge);
    expect(removed.action).not.toBe(message.action);
  });

  test("routes to the den's conversation, not to a post", () => {
    expect(getNotificationTarget(denMessage())).toEqual({
      conversationId: "den-1",
      kind: "conversation",
    });
  });

  test("routes off a den with no conversation to nowhere rather than to a post", () => {
    // The row still carries the base fixture's postId. A den message must never
    // fall through to a post target, or a den notification would open a post.
    const record = base({
      conversation: null,
      conversationId: null,
      type: "DEN_MESSAGE",
    });
    expect(getNotificationTarget(record)).toEqual({ kind: "none" });
  });

  test("exposes the den's name to a caller that wants it", () => {
    expect(notificationDenName(denMessage())).toBe("Study group");
    expect(notificationDenName(base({ type: "FOLLOW" }))).toBeNull();
  });

  test("uses the room glyph and its badge, not the two-person one", () => {
    const presentation = presentNotification(denMessage());
    expect(presentation.icon).toBe("Users");
    expect(presentation.badge).toEqual({ from: "#22d3ee", to: "#0891b2" });
  });
});
