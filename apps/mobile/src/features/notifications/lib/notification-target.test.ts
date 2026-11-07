import { describe, expect, test } from "bun:test";

import type {
  NotificationRecord,
  NotificationTarget,
  NotificationType,
} from "@asm/notifications/shared";
import { getNotificationTarget } from "@asm/notifications/shared";

import { nativeNotificationAction } from "./notification-target";

describe("nativeNotificationAction", () => {
  test("opens a post by its full id, carrying the comment like web", () => {
    const post = nativeNotificationAction({
      commentId: null,
      communitySlug: null,
      isGust: false,
      kind: "post",
      postId: "post-123",
    });
    expect(post.path).toEqual({
      params: { postId: "post-123" },
      pathname: "/posts/[postId]",
    });
    expect(post.notice).toBeUndefined();
    const comment = nativeNotificationAction({
      commentId: "c-9",
      communitySlug: "anime",
      isGust: false,
      kind: "post",
      postId: "post-123",
    });
    expect(comment.path).toEqual({
      params: { comment: "c-9", postId: "post-123" },
      pathname: "/posts/[postId]",
    });
  });

  test("a chat notification opens the community while chat is flagged off", () => {
    expect(
      nativeNotificationAction(
        { kind: "communityChat", slug: "anime" },
        { communityChatEnabled: false }
      ).path
    ).toEqual({ params: { slug: "anime" }, pathname: "/a/[slug]" });
  });

  test("a join-request row opens the community with its requests panel", () => {
    expect(
      nativeNotificationAction(
        { kind: "community", slug: "anime" },
        { requestsLink: true }
      ).path
    ).toEqual({
      params: { requests: "1", slug: "anime" },
      pathname: "/a/[slug]",
    });
    expect(
      nativeNotificationAction({ kind: "community", slug: "anime" }).path
    ).toEqual({ params: { slug: "anime" }, pathname: "/a/[slug]" });
  });

  test("opens native profiles, communities, chat and den conversations", () => {
    expect(
      nativeNotificationAction({ kind: "user", username: "alice" }).path
    ).toEqual({ params: { username: "alice" }, pathname: "/users/[username]" });
    expect(
      nativeNotificationAction({ kind: "community", slug: "code" }).path
    ).toEqual({ params: { slug: "code" }, pathname: "/a/[slug]" });
    expect(
      nativeNotificationAction({ kind: "communityChat", slug: "anime" }).path
    ).toEqual({ params: { slug: "anime" }, pathname: "/a/[slug]/chat" });
    expect(
      nativeNotificationAction({
        conversationId: "den-1",
        kind: "conversation",
      }).path
    ).toEqual({
      params: { conversationId: "den-1" },
      pathname: "/messages/[conversationId]",
    });
  });

  test("says there is nothing to open when the subject is gone", () => {
    // A membership that ended. There is no thread to open by construction, so a
    // notice that says so is the whole message rather than a dead row.
    const action = nativeNotificationAction({ kind: "none" });
    expect(action.notice?.title).toBe("Nothing left to open");
    expect(action.path).toBeUndefined();
  });

  test("every target produces something a tap can act on", () => {
    // The property, asserted across the closed set so a new target kind added to
    // the shared presenter cannot arrive here with no answer at all.
    const targets: NotificationTarget[] = [
      {
        commentId: null,
        communitySlug: null,
        isGust: false,
        kind: "post",
        postId: "p",
      },
      { kind: "community", slug: "anime" },
      { kind: "communityChat", slug: "anime" },
      { kind: "user", username: "alice" },
      { conversationId: "den-1", kind: "conversation" },
      { kind: "none" },
    ];
    for (const target of targets) {
      const action = nativeNotificationAction(target);
      const acts = Boolean(action.path) || Boolean(action.notice);
      expect(acts).toBe(true);
    }
  });
});

function record(
  type: NotificationType,
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord {
  return {
    comment: null,
    commentId: null,
    community: null,
    communityId: null,
    conversation: null,
    conversationId: null,
    count: 1,
    createdAt: "2026-10-26T12:00:00.000Z",
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
      id: "post-12345678",
      isGust: false,
      parentPostId: null,
    },
    postId: "post-12345678",
    read: false,
    recipientId: "author-1",
    type,
    ...overrides,
  };
}

// Every web TYPE_CONFIG type (notification.tsx) resolves to the native screen
// that opens the same subject: posts (community or global) to the post
// screen, follows to the profile, community rows to the community, dens to
// the conversation, and the ended-membership receipt to its notice.
describe("web notification types", () => {
  test("post engagement opens the post with its comment", () => {
    for (const type of [
      "AMPLIFY",
      "COMMENT",
      "MENTION",
      "MODERATION",
      "PUBLISHED",
      "REPLY",
      "TRANSCRIPTION",
    ] as const) {
      const action = nativeNotificationAction(
        getNotificationTarget(
          record(type, {
            comment: { id: "c-9", parent: null, parentId: null },
            commentId: "c-9",
          })
        )
      );
      expect(action.path).toEqual({
        params: { comment: "c-9", postId: "post-12345678" },
        pathname: "/posts/[postId]",
      });
    }
  });

  test("community post folds open the community", () => {
    const single = nativeNotificationAction(
      getNotificationTarget(
        record("COMMUNITY_POST", {
          community: { id: "c1", name: "Anime", slug: "anime" },
          communityId: "c1",
          post: {
            community: { slug: "anime" },
            content: "Fleet body",
            id: "post-12345678",
            isGust: false,
            parentPostId: null,
          },
        })
      )
    );
    expect(single.path).toEqual({
      params: { slug: "anime" },
      pathname: "/a/[slug]",
    });
    const folded = nativeNotificationAction(
      getNotificationTarget(
        record("COMMUNITY_POST", {
          community: { id: "c1", name: "Anime", slug: "anime" },
          communityId: "c1",
          count: 4,
        })
      )
    );
    expect(folded.path).toEqual({
      params: { slug: "anime" },
      pathname: "/a/[slug]",
    });
  });

  test("community membership rows open the community", () => {
    for (const type of [
      "COMMUNITY_JOIN_APPROVED",
      "COMMUNITY_JOIN_DECLINED",
      "COMMUNITY_JOIN_REQUEST",
    ] as const) {
      const action = nativeNotificationAction(
        getNotificationTarget(
          record(type, {
            community: { id: "c1", name: "Anime", slug: "anime" },
            communityId: "c1",
          })
        )
      );
      expect(action.path).toEqual({
        params: { slug: "anime" },
        pathname: "/a/[slug]",
      });
    }
  });

  test("community chat opens the chat screen", () => {
    const action = nativeNotificationAction(
      getNotificationTarget(
        record("COMMUNITY_CHAT", {
          community: { id: "c1", name: "Anime", slug: "anime" },
          communityId: "c1",
        })
      )
    );
    expect(action.path).toEqual({
      params: { slug: "anime" },
      pathname: "/a/[slug]/chat",
    });
  });

  test("a follow opens the short-profile user", () => {
    const action = nativeNotificationAction(
      getNotificationTarget(record("FOLLOW"))
    );
    expect(action.path).toEqual({
      params: { username: "alice" },
      pathname: "/users/[username]",
    });
  });

  test("a den message opens the conversation", () => {
    const action = nativeNotificationAction(
      getNotificationTarget(
        record("DEN_MESSAGE", {
          conversation: { id: "den-1", name: "Study group" },
          conversationId: "den-1",
        })
      )
    );
    expect(action.path).toEqual({
      params: { conversationId: "den-1" },
      pathname: "/messages/[conversationId]",
    });
  });

  test("an ended membership is a receipt with nothing to open", () => {
    for (const conversation of [
      { id: "den-1", name: "Study group" },
      null,
    ] as const) {
      const action = nativeNotificationAction(
        getNotificationTarget(
          record("DEN_MEMBERSHIP_ENDED", {
            conversation,
            conversationId: conversation?.id ?? null,
          })
        )
      );
      expect(action.path).toBeUndefined();
      expect(action.notice?.title).toBe("Nothing left to open");
    }
  });
});
