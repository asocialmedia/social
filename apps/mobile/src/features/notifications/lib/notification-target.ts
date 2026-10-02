import type { NotificationTarget } from "@asm/notifications/shared";

// What tapping a notification should do on this platform, decided in one place.
//
// A notification target is written by the shared presenter against the WEB's
// routes, because the web app is where the surfaces are. The native app has a
// subset of them, and the mismatch is not exceptional: a den is a whole feature
// that exists only on the web today, and its notifications are already arriving
// here. So every target has to name what this app can actually do, and the
// answer is allowed to be "tell the reader where the feature is".
//
// The rule, in order:
//
//   - a target the app has a screen for is navigated to;
//   - a target whose screen does not exist here but does on the web says so,
//     with a link out, rather than doing nothing or pushing a route that would
//     land on +not-found;
//   - a target with nowhere to go (a membership that ended, so there is no thread
//     left to open) says that instead of pretending.
//
// "Nothing happened on tap" is the one answer that is never right. A row that
// looks tappable and is not is a bug report waiting to happen, and the reason it
// is not right here is specific: the reader already has a den notification in
// this list and there is no den screen in this app, so silence teaches them the
// app is broken rather than that the feature is elsewhere.

export interface NativeNotificationAction {
  // Where to go, when there is somewhere to go.
  path?: string;
  // Shown as a toast when the target cannot be opened here. `title` is the
  // headline, `description` the sentence under it.
  notice?: { description: string; title: string };
  // True when the ROW is expected to have already navigated (a post target owns
  // its own short-id conversion), so the screen must not navigate a second time.
  handledByRow?: boolean;
}

const WEB_ONLY_NOTICE = {
  description: "That page is on the web. Open it there to carry on.",
  title: "Not in this app yet",
};

export function nativeNotificationAction(
  target: NotificationTarget
): NativeNotificationAction {
  switch (target.kind) {
    case "post": {
      // The row pushes the detail screen itself, because only it knows the
      // short-id convention. Saying so explicitly beats letting the screen guess
      // and push a second, wrong route.
      return { handledByRow: true };
    }
    case "user": {
      // A profile has a native screen, but a notification about somebody you do
      // not follow has nothing to show there that the reader does not already
      // have, and following is a surface this app does not drive. The feed is
      // the least surprising place to land.
      return { path: "/" };
    }
    case "community": {
      return { path: "/" };
    }
    case "conversation": {
      // A den thread. The app has no den surface and is not about to grow one
      // as a side effect of a notification tap, so the honest answer names the
      // gap and offers the web. A dead tap here would be invisible to us and
      // obvious to the reader.
      return {
        notice: {
          description:
            "Dens aren't in this app yet. Open the link on the web to read it.",
          title: "This den is on the web",
        },
      };
    }
    case "none": {
      // The membership that ended, or a row whose subject is gone. There is
      // nothing to open by construction, so the receipt is the whole message.
      return {
        notice: {
          description: WEB_ONLY_NOTICE.description,
          title: "Nothing left to open",
        },
      };
    }
    default: {
      return { notice: WEB_ONLY_NOTICE };
    }
  }
}
