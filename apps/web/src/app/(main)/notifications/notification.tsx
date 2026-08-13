"use client";

import type { NotificationData, NotificationType } from "@asm/db";
import { AtSign, Heart, MessageCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import type React from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn, formatRelativeDate } from "@/lib/utils";

interface NotificationProps {
  notification: NotificationData & {
    type: NotificationType;
  };
}

interface TypeConfig {
  action: string;
  badgeClass: string;
  href: (notification: NotificationProps["notification"]) => string;
  icon: React.ComponentType<{ className?: string }>;
}

const TYPE_CONFIG: Record<NotificationType, TypeConfig> = {
  FOLLOW: {
    action: "followed you",
    badgeClass: "bg-gradient-to-b from-[#ff9500] to-[#e65500]",
    icon: UserPlus,
    href: (notification) => `/users/${notification.issuer.username}`,
  },
  COMMENT: {
    action: "eddied on your post",
    badgeClass: "bg-gradient-to-b from-[#38bdf8] to-[#0284c7]",
    icon: MessageCircle,
    href: (notification) => `/posts/${notification.postId}`,
  },
  AMPLIFY: {
    action: "amplified your post",
    badgeClass: "bg-gradient-to-b from-[#fb7185] to-[#e11d48]",
    icon: Heart,
    href: (notification) => `/posts/${notification.postId}`,
  },
  MENTION: {
    action: "mentioned you",
    badgeClass: "bg-gradient-to-b from-[#a78bfa] to-[#7c3aed]",
    icon: AtSign,
    href: (notification) => `/posts/${notification.postId}`,
  },
};

export default function Notification({ notification }: NotificationProps) {
  const config = TYPE_CONFIG[notification.type];
  const Icon = config.icon;
  const href = config.href(notification);

  return (
    <Link
      className="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))] sm:px-4"
      href={href}
    >
      <div className="relative shrink-0">
        <UserAvatar
          avatarUrl={notification.issuer.avatarUrl}
          className="h-10 w-10"
        />
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_2px_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.15)]",
            config.badgeClass
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">
            {notification.issuer.displayName}
          </span>{" "}
          <span className="text-muted-foreground">{config.action}</span>
        </p>

        {notification.post ? (
          <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
            {notification.post.content}
          </p>
        ) : null}

        <span className="mt-1 block text-muted-foreground/70 text-xs">
          {formatRelativeDate(notification.createdAt)}
        </span>
      </div>

      {notification.read ? null : (
        <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-b from-[#ff9500] to-[#e65500] shadow-[0_0_0_2px_hsl(var(--background-alt))]" />
      )}
    </Link>
  );
}
