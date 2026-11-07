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
}

const WEB_ONLY_NOTICE = {
  description: "That page is on the web. Open it there to carry on.",
  title: "Not in this app yet",
};

export interface NativeNotificationOptions {
  // Community chat ships behind a flag. With it off the chat route redirects
  // home, so a chat notification opens the community page instead.
  communityChatEnabled?: boolean;
  // A join-request row lands on the community with its requests panel open,
  // matching web's `?requests=1` href.
  requestsLink?: boolean;
}

export function nativeNotificationAction(
  target: NotificationTarget,
  options: NativeNotificationOptions = {}
): NativeNotificationAction {
  const communityChatEnabled = options.communityChatEnabled ?? true;
  switch (target.kind) {
    case "post": {
      // Full id: truncated prefixes 404 when they match more than one post.
      // A comment notification carries `comment`, the same query web appends
      // so the detail screen can scroll the thread to that eddie.
      return {
        path: {
          params: target.commentId
            ? { comment: target.commentId, postId: target.postId }
            : { postId: target.postId },
          pathname: "/posts/[postId]",
        },
      };
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
      return {
        path: {
          params: options.requestsLink
            ? { requests: "1", slug: target.slug }
            : { slug: target.slug },
          pathname: "/a/[slug]",
        },
      };
    }
    case "communityChat": {
      if (!communityChatEnabled) {
        return {
          path: { params: { slug: target.slug }, pathname: "/a/[slug]" },
        };
      }
      return {
        path: {
          params: { slug: target.slug },
          pathname: "/a/[slug]/chat",
        },
      };
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
