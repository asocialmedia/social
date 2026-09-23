// Pure push payload builders. No I/O, no Prisma, no transport: given a
// notification row this decides the title, body, destination path and tag that
// every transport (web push and native push) then carries. Keeping it pure
// means the copy is unit-tested once and cannot drift between platforms.

import {
  notificationCommunitySlug,
  presentNotification,
} from "../shared/presenter";
import type { NotificationRecord, NotificationType } from "../shared/types";

export interface PushPayload {
  body: string;
  // Root-relative web path. Native maps the path onto its own routes; web opens
  // it directly.
  path: string;
  // Collapse key: notifications for the same post/eddie replace each other in
  // the tray instead of stacking, matching the grouped feed rows.
  tag: string;
  title: string;
}

// The post's path. Mirrors web getPostPath's community nesting and short-id
// convention; duplicated here (rather than imported from apps/web, which the
// worker cannot reach) because the worker needs the same address the feed link
// uses.
function postPath(notification: NotificationRecord): string | null {
  const { post } = notification;
  if (!post?.id) {
    return notification.postId ? `/posts/${notification.postId}` : null;
  }
  const shortId = post.id.length > 8 ? post.id.slice(0, 8) : post.id;
  const prefix = post.community?.slug
    ? `/a/${post.community.slug}/posts`
    : "/posts";
  const comment = notification.comment?.id
    ? `?comment=${notification.comment.id}`
    : "";
  return `${prefix}/${shortId}${comment}`;
}

export function notificationPath(notification: NotificationRecord): string {
  switch (notification.type) {
    case "FOLLOW": {
      return notification.issuer.username
        ? `/users/${notification.issuer.username}`
        : "/notifications";
    }
    case "COMMUNITY_POST": {
      return notification.community
        ? `/a/${notification.community.slug}`
        : (postPath(notification) ?? "/notifications");
    }
    default: {
      return postPath(notification) ?? "/notifications";
    }
  }
}

export function pushTag(notification: NotificationRecord): string {
  switch (notification.type) {
    case "FOLLOW": {
      return `follow:${notification.issuerId}`;
    }
    case "COMMUNITY_POST": {
      return `community:${notification.communityId ?? notification.postId ?? notification.id}`;
    }
    case "AMPLIFY": {
      const entity = notification.commentId ?? notification.postId;
      return entity ? `amplify:${entity}` : `amplify:${notification.id}`;
    }
    default: {
      return `${notification.type.toLowerCase()}:${notification.postId ?? notification.id}`;
    }
  }
}

// The persona notices (Zeph's publish receipt, moderation, transcription) are
// authored by the system account, whose display name would read oddly as a
// tray title, so they carry the product name instead.
const PRODUCT_TITLED: ReadonlySet<NotificationType> = new Set([
  "MODERATION",
  "PUBLISHED",
  "TRANSCRIPTION",
]);

function issuerName(notification: NotificationRecord): string {
  return (
    notification.issuer.displayName ?? notification.issuer.username ?? "Someone"
  );
}

export function buildPushPayload(
  notification: NotificationRecord
): PushPayload {
  const { action } = presentNotification(notification);
  const community = notificationCommunitySlug(notification);
  // The action already names the community for a community post ("posted a new
  // fleet in a/anime"); only append it when it does not.
  const suffix =
    community && !action.includes("a/") ? ` in a/${community}` : "";
  return {
    body: `${action}${suffix}`,
    path: notificationPath(notification),
    tag: pushTag(notification),
    title: PRODUCT_TITLED.has(notification.type)
      ? "asocialmedia"
      : issuerName(notification),
  };
}
