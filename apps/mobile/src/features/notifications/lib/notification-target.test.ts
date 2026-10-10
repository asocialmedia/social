import { describe, expect, test } from "bun:test";

import type { NotificationTarget } from "@asm/notifications/shared";

import { nativeNotificationAction } from "./notification-target";

// What tapping a notification does on a platform that does not have every surface
// the shared presenter can address.
//
// A notification target is written against the WEB's routes, because the web app
// is where the surfaces are. Dens are a whole feature that exists only on the web
// today, and their notifications are already arriving here - so "the target names
// something this app has no screen for" is the ordinary case, not the edge one.
//
// The one answer that is never right is nothing at all. A row that looks
// tappable and is not is a bug report waiting to happen, and here it is worse
// than usual: the reader already has a den notification in this list and there is
// no den screen in this app, so silence teaches them the app is broken rather
// than that the feature is elsewhere.

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

  test("lands a community or a profile on the feed", () => {
    // Both have real surfaces on the web and none worth deep-linking into from
    // here: a community row is a list of fleets and a profile row is a follow
    // button, and following is not something this app drives.
    for (const target of [
      { kind: "community", slug: "anime" },
      { kind: "user", username: "alice" },
    ] satisfies NotificationTarget[]) {
      expect(nativeNotificationAction(target)).toEqual({ path: "/" });
    }
  });

  test("names the gap for a den rather than doing nothing", () => {
    // The case this whole module exists for. A den thread has no native surface
    // and is not about to grow one as a side effect of a notification tap, so the
    // honest answer says where the feature is instead of swallowing the tap.
    const action = nativeNotificationAction({
      conversationId: "den-1",
      kind: "conversation",
    });
    expect(action.path).toBeUndefined();
    expect(action.notice?.title).toBe("This den is on the web");
    expect(action.notice?.description).toContain("aren't in this app yet");
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
