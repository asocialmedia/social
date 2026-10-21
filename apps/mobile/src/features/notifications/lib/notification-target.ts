import type { NotificationTarget } from "@asm/notifications/shared";
import type { Href } from "expo-router";

// Native destinations for the shared notification targets.

export interface NativeNotificationAction {
  // Where to go, when there is somewhere to go. Typed as `Href` rather than a
  // bare string because typed routes are on: `router.push` accepts only a known
  // route, and every path this function returns is one.
  path?: Href;
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
      return {
        path: {
          params: { username: target.username },
          pathname: "/users/[username]",
        },
      };
    }
    case "community": {
      return { path: { params: { slug: target.slug }, pathname: "/a/[slug]" } };
    }
    case "conversation": {
      return {
        path: {
          params: { conversationId: target.conversationId },
          pathname: "/messages/[conversationId]",
        },
      };
    }
    case "none": {
      // The membership that ended, or a row whose subject is gone. There is
      // nothing to open by construction, so the receipt is the whole message.
      return {
        notice: {
          description:
            "This subject is no longer available, or your membership has ended.",
          title: "Nothing left to open",
        },
      };
    }
    default: {
      return { notice: WEB_ONLY_NOTICE };
    }
  }
}
