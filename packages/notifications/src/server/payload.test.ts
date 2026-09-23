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
