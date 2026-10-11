import { describe, expect, test } from "bun:test";

import type { NotificationRecord } from "../shared/types";
import { buildPushPayload, notificationPath, pushTag } from "./payload";

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
    },
    issuerId: "alice",
    post: {
      community: null,
      content: "Post body",
      id: "post-1234567890",
      isGust: false,
      parentPostId: null,
    },
    postId: "post-1234567890",
    read: false,
    recipientId: "author-1",
    ...overrides,
  };
}

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

describe("push payload", () => {
  test("titles a follow with the issuer and bodies the verb", () => {
    const payload = buildPushPayload(base({ type: "FOLLOW" }));
    expect(payload.title).toBe("Alice");
    expect(payload.body).toBe("followed you");
    expect(payload.path).toBe("/users/alice");
  });

  test("titles a persona notice with the product name", () => {
    const payload = buildPushPayload(base({ type: "PUBLISHED" }));
    expect(payload.title).toBe("asocialmedia");
  });

  test("uses the short post id in the path", () => {
    expect(notificationPath(base({ type: "MENTION" }))).toBe("/posts/post-123");
  });

  test("nests a community post's path under the community", () => {
    const record = base({
      post: {
        community: { slug: "anime" },
        content: "Post body",
        id: "post-1234567890",
        isGust: false,
        parentPostId: null,
      },
      type: "MENTION",
    });
    expect(notificationPath(record)).toBe("/a/anime/posts/post-123");
  });

  test("appends the comment id so an eddie notification opens its thread", () => {
    const record = base({
      comment: { id: "c1", parent: null, parentId: null },
      commentId: "c1",
      type: "COMMENT",
    });
    expect(notificationPath(record)).toBe("/posts/post-123?comment=c1");
  });

  test("does not double the community suffix for a community post", () => {
    const record = base({
      community: { id: "comm-1", name: "Anime", slug: "anime" },
      communityId: "comm-1",
      count: 1,
      type: "COMMUNITY_POST",
    });
    const payload = buildPushPayload(record);
    expect(payload.body).toBe("posted a new fleet in a/anime");
    expect(payload.path).toBe("/a/anime");
  });

  test("appends the community suffix for engagement in a community", () => {
    const record = base({
      post: {
        community: { slug: "anime" },
        content: "Post body",
        id: "post-1234567890",
        isGust: false,
        parentPostId: null,
      },
      type: "AMPLIFY",
    });
    expect(buildPushPayload(record).body).toBe(
      "amplified your post in a/anime"
    );
  });

  test("tags an amplify by its subject so repeats collapse", () => {
    expect(pushTag(base({ type: "AMPLIFY" }))).toBe("amplify:post-1234567890");
    expect(
      pushTag(
        base({
          comment: { id: "c1", parent: null, parentId: null },
          commentId: "c1",
          type: "AMPLIFY",
        })
      )
    ).toBe("amplify:c1");
  });

  test("tags a follow by issuer and a community post by community", () => {
    expect(pushTag(base({ type: "FOLLOW" }))).toBe("follow:alice");
    expect(
      pushTag(
        base({
          community: { id: "comm-1", name: "Anime", slug: "anime" },
          communityId: "comm-1",
          type: "COMMUNITY_POST",
        })
      )
    ).toBe("community:comm-1");
  });
});

describe("a den message push", () => {
  test("titles with the sender and bodies the room, never the message", () => {
    const payload = buildPushPayload(denMessage());
    expect(payload.title).toBe("Alice");
    // The server only ever holds ciphertext, so the body has nothing to quote.
    // It says which room a message landed in and that a message arrived.
    expect(payload.body).toBe("sent a message in Study group");
  });

  test("bodies the folded count instead of repeating one message", () => {
    expect(buildPushPayload(denMessage({ count: 12 })).body).toBe(
      "12 new messages in Study group"
    );
  });

  test("opens the den, not a post", () => {
    expect(notificationPath(denMessage())).toBe("/messages?c=den-1");
  });

  test("escapes the conversation id it puts in the path", () => {
    expect(
      notificationPath(
        denMessage({
          conversation: { id: "a b&c", name: "Study group" },
          conversationId: "a b&c",
        })
      )
    ).toBe("/messages?c=a%20b%26c");
  });

  test("falls back to the notifications list with no conversation", () => {
    // The base fixture carries a postId, and a den row must never open a post.
    expect(
      notificationPath(
        base({ conversation: null, conversationId: null, type: "DEN_MESSAGE" })
      )
    ).toBe("/notifications");
  });

  test("tags by den, so a busy room replaces its own tray entry", () => {
    // Ninety-nine messages in one den would otherwise be ninety-nine stacked
    // notifications. The tag is per den, so the tray keeps one line.
    expect(pushTag(denMessage())).toBe("den:den-1");
    expect(pushTag(denMessage({ count: 99 }))).toBe("den:den-1");
  });

  test("tags an unaddressable den row by its own id", () => {
    expect(
      pushTag(
        base({ conversation: null, conversationId: null, type: "DEN_MESSAGE" })
      )
    ).toBe("den_message:notif-1");
  });

  test("sends a membership that ended to the list, not to a closed thread", () => {
    // The recipient is not a member of the den any more, so `/messages?c=<id>`
    // answers 404 for exactly the tap that produced this push. And a dissolve has
    // no thread to name at all. The receipt belongs where the reader already is.
    const removed = base({
      conversation: { id: "den-1", name: "Study group" },
      conversationId: "den-1",
      type: "DEN_MEMBERSHIP_ENDED",
    });
    const dissolved = base({
      conversation: null,
      conversationId: null,
      type: "DEN_MEMBERSHIP_ENDED",
    });
    for (const record of [removed, dissolved]) {
      expect(notificationPath(record)).toBe("/notifications");
      expect(buildPushPayload(record).path).toBe("/notifications");
    }
    // The body still says what happened, which is the entire point of sending it.
    expect(buildPushPayload(removed).body).toBe("removed you from Study group");
    expect(buildPushPayload(dissolved).body).toBe("deleted a den you were in");
  });

  test("tags a membership that ended per row, not per den", () => {
    // The opposite of a den message, deliberately. A message is noise that should
    // replace itself; a removal is the receipt for something that already
    // happened, and two of them in an hour are two pieces of news.
    const first = base({
      conversation: { id: "den-1", name: "Study group" },
      conversationId: "den-1",
      id: "notif-a",
      type: "DEN_MEMBERSHIP_ENDED",
    });
    const second = base({
      conversation: { id: "den-1", name: "Study group" },
      conversationId: "den-1",
      id: "notif-b",
      type: "DEN_MEMBERSHIP_ENDED",
    });
    expect(pushTag(first)).toBe("den_membership_ended:notif-a");
    expect(pushTag(second)).toBe("den_membership_ended:notif-b");
  });

  test("carries no member list, no post content and no key material", () => {
    // A den push is built from the row alone, and the row names two things: the
    // sender and the den. Nothing here can describe the roster.
    const payload = buildPushPayload(denMessage());
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("member");
    expect(serialized).not.toContain("Bob");
    expect(serialized).not.toContain("Carol");
    // The post fixture's content is not a den message's business either.
    expect(payload.body).not.toContain("Post body");
  });
});
