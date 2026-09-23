import type { NotificationRecord, NotificationType } from "./types";

// Where tapping a notification should land, expressed structurally so each
// platform can resolve it against its own routes. Web builds the canonical
// `/posts/<shortId>/<slug>` or `/a/<slug>/posts/...` address; the native app
// maps the same target onto its `/posts/[postId]` screen and falls back to the
// notifications list for surfaces it does not have yet.
export type NotificationTarget =
  | {
      kind: "post";
      postId: string;
      // The post's community, when it was published into one.
      communitySlug: string | null;
      // Set on engagement with an eddie (comment), so the link can deep-link
      // the thread.
      commentId: string | null;
      isGust: boolean;
    }
  | { kind: "community"; slug: string }
  | { kind: "user"; username: string }
  | { kind: "none" };

// One run of the headline. `emphasis: "name"` renders bold ink; `"action"`
// renders muted. Splitting the sentence this way lets web and native share the
// exact copy and emphasis without sharing a renderer.
export interface HeadlineSegment {
  emphasis: "action" | "name";
  text: string;
}

export interface NotificationPresentation {
  // The verb phrase alone, e.g. "amplified your post in a/anime". Used as the
  // accessible label and by the push body.
  action: string;
  // The full sentence, split into styled runs.
  headline: HeadlineSegment[];
  target: NotificationTarget;
  // Gradient endpoints for the type badge. Kept here (not in either UI) so the
  // two clients cannot drift.
  badge: { from: string; to: string };
  // Lucide icon component name; both clients resolve it from their own lucide
  // package, which exposes identical names.
  icon: NotificationIconName;
}

export type NotificationIconName =
  | "AtSign"
  | "Captions"
  | "CornerDownRight"
  | "Heart"
  | "LayoutGrid"
  | "MessageCircle"
  | "ShieldAlert"
  | "Sparkles"
  | "UserPlus";

// Gradient endpoints mirror web's notification.tsx badgeClass exactly.
const TYPE_META: Record<
  NotificationType,
  { badge: { from: string; to: string }; icon: NotificationIconName }
> = {
  AMPLIFY: {
    badge: { from: "#fb7185", to: "#e11d48" },
    icon: "Heart",
  },
  COMMENT: {
    badge: { from: "#38bdf8", to: "#0284c7" },
    icon: "MessageCircle",
  },
  COMMUNITY_POST: {
    badge: { from: "#a78bfa", to: "#4f46e5" },
    icon: "LayoutGrid",
  },
  FOLLOW: {
    badge: { from: "#ff9500", to: "#e65500" },
    icon: "UserPlus",
  },
  MENTION: {
    badge: { from: "#a78bfa", to: "#7c3aed" },
    icon: "AtSign",
  },
  MODERATION: {
    badge: { from: "#fbbf24", to: "#f97316" },
    icon: "ShieldAlert",
  },
  PUBLISHED: {
    badge: { from: "#34d399", to: "#0d9488" },
    icon: "Sparkles",
  },
  REPLY: {
    badge: { from: "#38bdf8", to: "#2563eb" },
    icon: "CornerDownRight",
  },
  TRANSCRIPTION: {
    badge: { from: "#fbbf24", to: "#ea580c" },
    icon: "Captions",
  },
};

// The community a notification's post belongs to, when it was published into
// one. Engagement on a community post names the space rather than reading as if
// it happened on the global feed. Prefers the notification row's own community
// (set on COMMUNITY_POST) and falls back to the post's community, which every
// other type carries.
export function notificationCommunitySlug(
  notification: NotificationRecord
): string | null {
  return (
    notification.community?.slug ?? notification.post?.community?.slug ?? null
  );
}

// " in a/<slug>" for a community post, empty otherwise.
function communitySuffix(notification: NotificationRecord): string {
  const slug = notificationCommunitySlug(notification);
  return slug ? ` in a/${slug}` : "";
}

function isEddie(notification: NotificationRecord): boolean {
  return Boolean(notification.comment);
}

function postNoun(notification: NotificationRecord): "gust" | "post" {
  return notification.post?.isGust ? "gust" : "post";
}

function getCommentAction(notification: NotificationRecord): string {
  const { comment } = notification;
  const suffix = communitySuffix(notification);
  if (!comment || comment.parentId === null) {
    return `eddied on your post${suffix}`;
  }
  if (comment.parent?.userId === notification.recipientId) {
    return `replied to your eddie${suffix}`;
  }
  return `replied on your post${suffix}`;
}

function getAction(notification: NotificationRecord): string {
  const suffix = communitySuffix(notification);
  switch (notification.type) {
    case "AMPLIFY": {
      return notification.comment
        ? `amplified your eddie${suffix}`
        : `amplified your post${suffix}`;
    }
    case "COMMENT": {
      return getCommentAction(notification);
    }
    case "COMMUNITY_POST": {
      const slug = notification.community?.slug ?? "";
      return notification.count > 1
        ? `${notification.count} new fleets posted in a/${slug}`
        : `posted a new fleet in a/${slug}`;
    }
    case "FOLLOW": {
      return "followed you";
    }
    case "MENTION": {
      return `mentioned you${suffix}`;
    }
    case "MODERATION": {
      return `flagged your ${postNoun(notification)}${suffix}`;
    }
    case "PUBLISHED": {
      return `your ${postNoun(notification)} is live${suffix}`;
    }
    case "REPLY": {
      return `responded to your post${suffix}`;
    }
    case "TRANSCRIPTION": {
      return `captions & transcript ready for your ${postNoun(notification)}${suffix}`;
    }
    default: {
      return "sent you a notification";
    }
  }
}

// The link target a notification resolves to. A community post goes to its
// /a/<slug> home only for the batched COMMUNITY_POST row (which spans several
// authors); every other type points at the individual post.
export function getNotificationTarget(
  notification: NotificationRecord
): NotificationTarget {
  if (notification.type === "COMMUNITY_POST" && notification.community) {
    return { kind: "community", slug: notification.community.slug };
  }
  if (notification.type === "FOLLOW") {
    return { kind: "user", username: notification.issuer.username ?? "" };
  }
  if (notification.post?.id) {
    return {
      commentId: notification.comment?.id ?? null,
      communitySlug: notification.post.community?.slug ?? null,
      isGust: Boolean(notification.post.isGust),
      kind: "post",
      postId: notification.post.id,
    };
  }
  if (notification.postId) {
    return {
      commentId: notification.comment?.id ?? null,
      communitySlug: null,
      isGust: false,
      kind: "post",
      postId: notification.postId,
    };
  }
  return { kind: "none" };
}

// Joins the issuer names and the action into styled runs, mirroring web's
// NotificationHeadline. A folded COMMUNITY_POST row spans several authors, so
// it is community-level and carries no subject name.
function buildHeadline(
  notification: NotificationRecord,
  issuers: NotificationRecord["issuer"][],
  action: string
): HeadlineSegment[] {
  if (notification.type === "COMMUNITY_POST" && notification.count > 1) {
    return [{ emphasis: "action", text: action }];
  }
  if (notification.type !== "AMPLIFY" || issuers.length <= 1) {
    const [single] = issuers;
    const name = single?.displayName ?? single?.username ?? "";
    return [
      { emphasis: "name", text: name },
      { emphasis: "action", text: ` ${action}` },
    ];
  }

  const noun = isEddie(notification) ? "eddie" : "post";
  const tail = ` ${communitySuffix(notification)}`;
  const names = issuers.map(
    (issuer) => issuer.displayName ?? issuer.username ?? ""
  );

  if (names.length === 2) {
    return [
      { emphasis: "name", text: names[0] ?? "" },
      { emphasis: "action", text: " and " },
      { emphasis: "name", text: names[1] ?? "" },
      { emphasis: "action", text: ` amplified your ${noun}${tail}` },
    ];
  }
  if (names.length === 3) {
    return [
      { emphasis: "name", text: names[0] ?? "" },
      { emphasis: "action", text: ", " },
      { emphasis: "name", text: names[1] ?? "" },
      { emphasis: "action", text: " and " },
      { emphasis: "name", text: names[2] ?? "" },
      { emphasis: "action", text: ` amplified your ${noun}${tail}` },
    ];
  }
  const others = names.length - 2;
  return [
    { emphasis: "name", text: names[0] ?? "" },
    { emphasis: "action", text: ", " },
    { emphasis: "name", text: names[1] ?? "" },
    { emphasis: "action", text: " and " },
    { emphasis: "name", text: `+${others} others` },
    { emphasis: "action", text: ` amplified your ${noun}${tail}` },
  ];
}

// Everything a client needs to render and route one notification (grouped or
// not). Pass `issuers` for a grouped row; it defaults to the single issuer.
export function presentNotification(
  notification: NotificationRecord,
  issuers: NotificationRecord["issuer"][] = [notification.issuer]
): NotificationPresentation {
  const meta = TYPE_META[notification.type];
  const action = getAction(notification);
  return {
    action,
    badge: meta.badge,
    headline: buildHeadline(notification, issuers, action),
    icon: meta.icon,
    target: getNotificationTarget(notification),
  };
}

// Plain-text headline, for push bodies and accessibility labels.
export function notificationHeadlineText(
  notification: NotificationRecord,
  issuers: NotificationRecord["issuer"][] = [notification.issuer]
): string {
  return presentNotification(notification, issuers)
    .headline.map((segment) => segment.text)
    .join("")
    .trim();
}
