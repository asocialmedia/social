"use client";

import type {
  GroupedNotificationData,
  NotificationData,
  NotificationType,
} from "@asm/db";
import type { NotificationIssuer } from "@asm/notifications/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Captions,
  CornerDownRight,
  Heart,
  LayoutGrid,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import type React from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import kyInstance from "@/lib/ky";
import { getPostPath } from "@/lib/seo/seo";
import { cn, formatRelativeDate } from "@/lib/utils";

interface NotificationProps {
  notification: (NotificationData | GroupedNotificationData) & {
    type: NotificationType;
  };
}

interface TypeConfig {
  action: (notification: NotificationProps["notification"]) => string;
  badgeClass: string;
  href: (notification: NotificationProps["notification"]) => string;
  icon: React.ComponentType<{ className?: string }>;
}

// The community a notification's post belongs to, when it was published into
// one. Engagement on a community post names the space rather than reading as if
// it happened on the global feed. Prefers the notification row's own community
// (set on COMMUNITY_POST) and falls back to the post's community, which every
// other type carries.
function notificationCommunitySlug(
  notification: NotificationProps["notification"]
): string | null {
  return (
    notification.community?.slug ?? notification.post?.community?.slug ?? null
  );
}

// " in a/<slug>" for a community post, empty otherwise. Appended to the action
// so a single sentence explains both what happened and where.
function communitySuffix(
  notification: NotificationProps["notification"]
): string {
  const slug = notificationCommunitySlug(notification);
  return slug ? ` in a/${slug}` : "";
}

// Comment notifications carry the linked comment when available, so replies
// read differently from top-level eddies and link straight into the thread.
function getCommentAction(
  notification: NotificationProps["notification"]
): string {
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

// A notification's post link resolves to the canonical address: a community
// post goes to its /a/<slug>/posts/... home, everything else to /posts/....
function getNotificationPostHref(
  notification: NotificationProps["notification"]
): string {
  const { post } = notification;
  if (post?.id) {
    return getPostPath(post);
  }
  return notification.postId
    ? `/posts/${notification.postId}`
    : "/notifications";
}

function getCommentHref(
  notification: NotificationProps["notification"]
): string {
  const base = getNotificationPostHref(notification);
  return notification.comment
    ? `${base}?comment=${notification.comment.id}`
    : base;
}

// A den's name, for the row that names both the sender and the room. Falls back
// to an unnamed den so a missing conversation cannot read as "Alice in :".
function denLabel(notification: NotificationProps["notification"]): string {
  const name = notification.conversation?.name?.trim();
  return name && name.length > 0 ? name : "a den";
}

// What happened in the den, before its name. The server only ever holds
// ciphertext, so there is never a message to quote here.
function denVerb(notification: NotificationProps["notification"]): string {
  return notification.count > 1
    ? `${notification.count} new messages`
    : "sent a message";
}

const TYPE_CONFIG: Record<NotificationType, TypeConfig> = {
  AMPLIFY: {
    action: (notification) =>
      notification.comment
        ? `amplified your eddie${communitySuffix(notification)}`
        : `amplified your post${communitySuffix(notification)}`,
    badgeClass: "bg-gradient-to-b from-[#fb7185] to-[#e11d48]",
    href: (notification) =>
      notification.comment
        ? getCommentHref(notification)
        : getNotificationPostHref(notification),
    icon: Heart,
  },
  COMMENT: {
    action: getCommentAction,
    badgeClass: "bg-gradient-to-b from-[#38bdf8] to-[#0284c7]",
    href: getCommentHref,
    icon: MessageCircle,
  },
  // Batched community activity: one rolling row per community, naming it and
  // how many posts have landed since the row was last read. Links to the
  // community so the reader lands in the space, not on a single post.
  COMMUNITY_POST: {
    // A folded row spans several authors, so the headline is community-level and
    // carries no subject; only the single-post row is attributed to its author
    // (via the shared issuer-name headline).
    action: (notification) =>
      notification.count > 1
        ? `${notification.count} new fleets posted in a/${notification.community?.slug ?? ""}`
        : `posted a new fleet in a/${notification.community?.slug ?? ""}`,
    badgeClass: "bg-gradient-to-b from-violet-400 to-indigo-600",
    href: (notification) =>
      notification.community
        ? `/a/${notification.community.slug}`
        : getNotificationPostHref(notification),
    icon: LayoutGrid,
  },
  // A den membership that ended without the recipient's consent. Links to the
  // notifications list rather than to the den, because the recipient is no longer
  // a member of it: the thread is closed to them, so the den's own address would
  // answer 404 for exactly the tap that produced this row.
  DEN_MEMBERSHIP_ENDED: {
    action: (notification) =>
      notification.conversation
        ? `removed you from ${denLabel(notification)}`
        : "deleted a den you were in",
    badgeClass: "bg-gradient-to-b from-red-400 to-red-700",
    href: () => "/notifications",
    icon: Users,
  },
  // A message in a den. The room is set in the same ink as the sender's name
  // ("Alice in Study group: sent a message"), because with a full inbox the den
  // is the only thing that says which conversation a row belongs to.
  DEN_MESSAGE: {
    action: (notification) => denVerb(notification),
    badgeClass: "bg-gradient-to-b from-cyan-300 to-cyan-700",
    href: (notification) =>
      notification.conversation
        ? `/messages?c=${encodeURIComponent(notification.conversation.id)}`
        : "/messages",
    icon: Users,
  },
  FOLLOW: {
    action: () => "followed you",
    badgeClass: "bg-gradient-to-b from-[#ff9500] to-[#e65500]",
    href: (notification) => `/users/${notification.issuer.username}`,
    icon: UserPlus,
  },
  MENTION: {
    action: (notification) => `mentioned you${communitySuffix(notification)}`,
    badgeClass: "bg-gradient-to-b from-[#a78bfa] to-[#7c3aed]",
    href: getNotificationPostHref,
    icon: AtSign,
  },
  MODERATION: {
    action: (notification) =>
      notification.post?.isGust
        ? `flagged your gust${communitySuffix(notification)}`
        : `flagged your post${communitySuffix(notification)}`,
    badgeClass: "bg-gradient-to-b from-amber-400 to-orange-500",
    href: getNotificationPostHref,
    icon: ShieldAlert,
  },
  // Platform-persona notice: the pipeline finished publishing the upload.
  PUBLISHED: {
    action: (notification) =>
      notification.post?.isGust
        ? `your gust is live${communitySuffix(notification)}`
        : `your fleet is live${communitySuffix(notification)}`,
    badgeClass: "bg-gradient-to-b from-emerald-400 to-teal-600",
    href: getNotificationPostHref,
    icon: Sparkles,
  },
  // A post-to-post reply: the postId points at the response itself, so the
  // link opens the response's permalink (with its parent card).
  REPLY: {
    action: (notification) =>
      `responded to your post${communitySuffix(notification)}`,
    badgeClass: "bg-gradient-to-b from-sky-400 to-blue-600",
    href: getNotificationPostHref,
    icon: CornerDownRight,
  },
  // Platform-persona notice: closed captions and transcript were generated.
  TRANSCRIPTION: {
    action: (notification) =>
      notification.post?.isGust
        ? `captions & transcript ready for your gust${communitySuffix(notification)}`
        : `captions & transcript ready for your post${communitySuffix(notification)}`,
    badgeClass: "bg-gradient-to-b from-amber-400 to-orange-600",
    href: getNotificationPostHref,
    icon: Captions,
  },
};

function NotificationAvatars({
  badgeClass,
  icon: Icon,
  issuers,
  type,
}: {
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
  issuers: NotificationIssuer[];
  type: NotificationType;
}) {
  if (type !== "AMPLIFY" || issuers.length <= 1) {
    const [singleIssuer] = issuers;
    return (
      <div className="relative shrink-0">
        <UserAvatar avatarUrl={singleIssuer?.avatarUrl} className="h-10 w-10" />
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_2px_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.15)]",
            badgeClass
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
      </div>
    );
  }

  // Multi-avatar display: show up to 3 avatars directly; if > 3, show 2 avatars plus "+ N" pill
  const visibleIssuers = issuers.length <= 3 ? issuers : issuers.slice(0, 2);
  const remainingCount = issuers.length - visibleIssuers.length;

  return (
    <div className="relative flex shrink-0 items-center pr-1">
      <div className="flex items-center -space-x-4">
        {visibleIssuers.map((issuer, idx) => (
          <div
            className="ring-background relative rounded-full ring-2"
            key={issuer.id}
            style={{ zIndex: visibleIssuers.length - idx + 1 }}
          >
            <UserAvatar avatarUrl={issuer.avatarUrl} className="h-9 w-9" />
          </div>
        ))}
        {remainingCount > 0 ? (
          <div
            className="border-border/80 bg-muted/90 text-foreground ring-background relative z-0 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold shadow-sm ring-2"
            title={`+${remainingCount} others`}
          >
            +{remainingCount}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          "absolute -right-1 -bottom-1 z-20 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_2px_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.15)]",
          badgeClass
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
    </div>
  );
}

function NotificationHeadline({
  action,
  batchCount,
  communitySuffixText,
  denLabelText,
  denVerbText,
  isEddie,
  issuers,
  type,
}: {
  action: string;
  // >1 only for a folded COMMUNITY_POST row, whose activity spans several
  // authors, so there is no single person to name.
  batchCount: number;
  communitySuffixText: string;
  // A den row reads "Alice in Study group: sent a message", so it supplies its
  // own two halves instead of one trailing action phrase.
  denLabelText: string;
  denVerbText: string;
  isEddie: boolean;
  issuers: NotificationIssuer[];
  type: NotificationType;
}) {
  if (type === "DEN_MESSAGE") {
    return (
      <p className="text-sm leading-snug">
        <span className="font-semibold">{issuers[0]?.displayName}</span>{" "}
        <span className="text-muted-foreground">in</span>{" "}
        <span className="font-semibold">{denLabelText}</span>
        <span className="text-muted-foreground">: {denVerbText}</span>
      </p>
    );
  }

  if (batchCount > 1) {
    return (
      <p className="text-sm leading-snug">
        <span className="text-muted-foreground">{action}</span>
      </p>
    );
  }

  if (type !== "AMPLIFY" || issuers.length <= 1) {
    const [singleIssuer] = issuers;
    return (
      <p className="text-sm leading-snug">
        <span className="font-semibold">{singleIssuer?.displayName}</span>{" "}
        <span className="text-muted-foreground">{action}</span>
      </p>
    );
  }

  const targetNoun = isEddie ? "eddie" : "post";
  const tail = ` ${communitySuffixText}`;

  if (issuers.length === 2) {
    const [firstIssuer, secondIssuer] = issuers;
    return (
      <p className="text-sm leading-snug">
        <span className="font-semibold">{firstIssuer?.displayName}</span>{" "}
        <span className="text-muted-foreground">and</span>{" "}
        <span className="font-semibold">{secondIssuer?.displayName}</span>{" "}
        <span className="text-muted-foreground">
          amplified your {targetNoun}
          {tail}
        </span>
      </p>
    );
  }

  if (issuers.length === 3) {
    const [firstIssuer, secondIssuer, thirdIssuer] = issuers;
    return (
      <p className="text-sm leading-snug">
        <span className="font-semibold">{firstIssuer?.displayName}</span>
        <span className="text-muted-foreground">, </span>
        <span className="font-semibold">{secondIssuer?.displayName}</span>{" "}
        <span className="text-muted-foreground">and</span>{" "}
        <span className="font-semibold">{thirdIssuer?.displayName}</span>{" "}
        <span className="text-muted-foreground">
          amplified your {targetNoun}
          {tail}
        </span>
      </p>
    );
  }

  const [firstIssuer, secondIssuer] = issuers;
  const othersCount = issuers.length - 2;
  return (
    <p className="text-sm leading-snug">
      <span className="font-semibold">{firstIssuer?.displayName}</span>
      <span className="text-muted-foreground">, </span>
      <span className="font-semibold">{secondIssuer?.displayName}</span>{" "}
      <span className="text-muted-foreground">and</span>{" "}
      <span className="font-semibold">+{othersCount} others</span>{" "}
      <span className="text-muted-foreground">
        amplified your {targetNoun}
        {tail}
      </span>
    </p>
  );
}

export default function Notification({ notification }: NotificationProps) {
  const config = TYPE_CONFIG[notification.type];
  const Icon = config.icon;
  const href = config.href(notification);
  const action = config.action(notification);
  const queryClient = useQueryClient();

  const issuers =
    "issuers" in notification && notification.issuers?.length
      ? notification.issuers
      : [notification.issuer];
  const allIds =
    "allNotificationIds" in notification &&
    notification.allNotificationIds?.length
      ? notification.allNotificationIds
      : [notification.id];

  const { mutate: dismiss } = useMutation({
    mutationFn: () =>
      kyInstance.delete(`/api/notifications/${allIds.join(",")}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({
        queryKey: ["unread-notification-count"],
      });
    },
  });

  const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };

  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-4 py-3 transition-colors duration-150",
        notification.read
          ? "hover:bg-[hsl(var(--muted))]"
          : "bg-[hsl(var(--primary)/0.07)] hover:bg-[hsl(var(--primary)/0.11)]"
      )}
    >
      <Link className="flex min-w-0 flex-1 items-start gap-3" href={href}>
        <NotificationAvatars
          badgeClass={config.badgeClass}
          icon={Icon}
          issuers={issuers}
          type={notification.type}
        />

        <div className="min-w-0 flex-1">
          <NotificationHeadline
            action={action}
            batchCount={
              notification.type === "COMMUNITY_POST" ? notification.count : 0
            }
            communitySuffixText={communitySuffix(notification)}
            denLabelText={denLabel(notification)}
            denVerbText={denVerb(notification)}
            isEddie={Boolean(notification.comment)}
            issuers={issuers}
            type={notification.type}
          />

          {notification.post ? (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
              {notification.post.content}
            </p>
          ) : null}

          <span className="text-muted-foreground/70 mt-1 block text-xs">
            {formatRelativeDate(notification.createdAt)}
          </span>
        </div>
      </Link>

      {/* Always visible: an opacity-0 affordance is unreachable on touch and
          invisible at a glance. Hover/focus only deepens it, never reveals it. */}
      <button
        aria-label="Dismiss notification"
        className="icon-btn-3d text-muted-foreground mt-1 flex h-7 w-7 shrink-0 items-center justify-center opacity-60 transition-opacity duration-150 outline-none group-hover:opacity-100 focus-visible:opacity-100"
        onClick={handleDismiss}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
