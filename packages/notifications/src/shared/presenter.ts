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
  // A den (group conversation) thread, opened by id. Carries no name and no
  // roster: the surface that renders it already knows who the reader is, and a
  // notification must not describe the den's membership to anyone.
  | { kind: "conversation"; conversationId: string }
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
  | "UserPlus"
  | "Users";

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
  // A den membership that ended without the recipient's consent. The room glyph,
  // as a message in a den has, but in red rather than the den's cyan: this is the
  // same conversation as a DEN_MESSAGE and it must not look like another message
  // arriving in it.
  DEN_MEMBERSHIP_ENDED: {
    badge: { from: "#f87171", to: "#b91c1c" },
    icon: "Users",
  },
  // A message in a den. The two-person glyph belongs to COMMENT, which is about
  // your own post; a den is a room, so it gets the room glyph.
  DEN_MESSAGE: {
    badge: { from: "#22d3ee", to: "#0891b2" },
    icon: "Users",
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

// The den a row names, or null when it carries no conversation. A DEN_MESSAGE
// always has one (the foreign key cascades, so a live row does); a
// DEN_MEMBERSHIP_ENDED row has one only for a removal, because a dissolve
// deletes the den and the cascade would take the notification with it. The null
// case is handled rather than asserted so a hand-built row cannot crash a
// render.
export function notificationDenName(
  notification: NotificationRecord
): string | null {
  return notification.conversation?.name ?? null;
}

// Falls back to an unnamed den rather than to an empty string, which would
// read as "Alice in : sent a message".
function denLabel(notification: NotificationRecord): string {
  const name = notificationDenName(notification)?.trim();
  return name && name.length > 0 ? name : "a den";
}

// What happened in the den, before its name. The server only ever holds
// ciphertext, so there is never a message to quote: the copy says a message
// arrived and never what it said.
function denVerb(notification: NotificationRecord): string {
  return notification.count > 1
    ? `${notification.count} new messages`
    : "sent a message";
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
    case "DEN_MEMBERSHIP_ENDED": {
      // The den is named only when it still exists, which is the removal case.
      // A dissolve has no den to name, so the sentence is deliberately generic:
      // claiming a name here would be printing something the row does not carry
      // and could not survive the cascade.
      return notification.conversation
        ? `removed you from ${denLabel(notification)}`
        : "deleted a den you were in";
    }
    case "DEN_MESSAGE": {
      // "sent a message in Study group". This is also the push body, so it
      // stands alone under the sender's name as a tray title rather than
      // carrying the "in <den>" clause twice.
      return `${denVerb(notification)} in ${denLabel(notification)}`;
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
// authors); a den message opens the den; every other type points at the
// individual post.
export function getNotificationTarget(
  notification: NotificationRecord
): NotificationTarget {
  if (notification.type === "COMMUNITY_POST" && notification.community) {
    return { kind: "community", slug: notification.community.slug };
  }
  if (notification.type === "FOLLOW") {
    return { kind: "user", username: notification.issuer.username ?? "" };
  }
  if (notification.type === "DEN_MESSAGE") {
    const conversationId =
      notification.conversation?.id ?? notification.conversationId ?? null;
    return conversationId
      ? { conversationId, kind: "conversation" }
      : { kind: "none" };
  }
  // Nowhere to go, and deliberately so. The recipient of this row is no longer
  // a member of the den, so the thread it names is closed to them, and a
  // dissolved den has no thread at all. Pointing at either would be a tap that
  // lands on a 404. The row is information, not a route.
  if (notification.type === "DEN_MEMBERSHIP_ENDED") {
    return { kind: "none" };
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

// "Alice", "Alice and Bob", "Alice, Bob and Carol", "Alice, Bob and +3 others".
// The name runs on their own so a caller can append whatever tail its type
// needs: a den appends "in <den>: <what happened>", an amplify appends the
// thing that was amplified.
function namesRun(issuers: NotificationRecord["issuer"][]): HeadlineSegment[] {
  const names = issuers.map(
    (issuer) => issuer.displayName ?? issuer.username ?? ""
  );
  const [first, second, third] = names;
  if (names.length <= 1) {
    return [{ emphasis: "name", text: first ?? "" }];
  }
  if (names.length === 2) {
    return [
      { emphasis: "name", text: first ?? "" },
      { emphasis: "action", text: " and " },
      { emphasis: "name", text: second ?? "" },
    ];
  }
  if (names.length === 3) {
    return [
      { emphasis: "name", text: first ?? "" },
      { emphasis: "action", text: ", " },
      { emphasis: "name", text: second ?? "" },
      { emphasis: "action", text: " and " },
      { emphasis: "name", text: third ?? "" },
    ];
  }
  return [
    { emphasis: "name", text: first ?? "" },
    { emphasis: "action", text: ", " },
    { emphasis: "name", text: second ?? "" },
    { emphasis: "action", text: " and " },
    { emphasis: "name", text: `+${names.length - 2} others` },
  ];
}

// A den message names the room as well as the person, and the room comes
// first: "Alice in Study group: sent a message". An inbox with forty rows in it
// gives the reader no other way to tell which conversation a row belongs to, so
// the den is set in the same ink as the sender's name instead of trailing the
// verb phrase where a glance misses it.
function denHeadline(
  notification: NotificationRecord,
  issuers: NotificationRecord["issuer"][]
): HeadlineSegment[] {
  return [
    ...namesRun(issuers),
    { emphasis: "action", text: " in " },
    { emphasis: "name", text: denLabel(notification) },
    { emphasis: "action", text: `: ${denVerb(notification)}` },
  ];
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
  if (notification.type === "DEN_MESSAGE") {
    return denHeadline(notification, issuers);
  }
  if (notification.type === "DEN_MEMBERSHIP_ENDED") {
    // The plain issuer-then-action shape, which is already the default below, is
    // the whole of it: there is no room to name on a dissolve, and on a removal
    // the room is inside the action. Spelled out rather than left to the
    // fallback so a future branch here cannot change this row's shape by
    // accident.
    const [single] = issuers;
    return [
      {
        emphasis: "name",
        text: single?.displayName ?? single?.username ?? "",
      },
      { emphasis: "action", text: ` ${action}` },
    ];
  }
  if (notification.type !== "AMPLIFY" || issuers.length <= 1) {
    const [single] = issuers;
    return [
      { emphasis: "name", text: single?.displayName ?? single?.username ?? "" },
      { emphasis: "action", text: ` ${action}` },
    ];
  }

  const noun = isEddie(notification) ? "eddie" : "post";
  return [
    ...namesRun(issuers),
    {
      emphasis: "action",
      text: ` amplified your ${noun}${communitySuffix(notification)}`,
    },
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
