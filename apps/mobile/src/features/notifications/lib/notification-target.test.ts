import { describe, expect, test } from "bun:test";

import type { NotificationTarget } from "@asm/notifications/shared";

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
