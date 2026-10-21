import { describe, expect, test } from "bun:test";

import type { NotificationTarget } from "@asm/notifications/shared";

import { nativeNotificationAction } from "./notification-target";

describe("nativeNotificationAction", () => {
  test("leaves a post to the row, which owns the short-id convention", () => {
    // Not "navigates to the post": the row pushes the detail screen itself,
    // because only it knows that web paths carry a short id. Saying so explicitly
    // beats letting the screen guess and push a second, wrong route.
    const action = nativeNotificationAction({
      commentId: null,
      communitySlug: null,
      isGust: false,
      kind: "post",
      postId: "post-123",
    });
    expect(action.handledByRow).toBe(true);
    expect(action.path).toBeUndefined();
    expect(action.notice).toBeUndefined();
  });

  test("opens native profiles, communities and den conversations", () => {
    expect(
      nativeNotificationAction({ kind: "user", username: "alice" }).path
    ).toEqual({ params: { username: "alice" }, pathname: "/users/[username]" });
    expect(
      nativeNotificationAction({ kind: "community", slug: "code" }).path
    ).toEqual({ params: { slug: "code" }, pathname: "/a/[slug]" });
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
      { kind: "user", username: "alice" },
      { conversationId: "den-1", kind: "conversation" },
      { kind: "none" },
    ];
    for (const target of targets) {
      const action = nativeNotificationAction(target);
      const acts =
        Boolean(action.path) ||
        Boolean(action.notice) ||
        Boolean(action.handledByRow);
      expect(acts).toBe(true);
    }
  });
});
