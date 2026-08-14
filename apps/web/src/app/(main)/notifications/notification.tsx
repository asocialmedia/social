"use client";

import type { NotificationData, NotificationType } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Heart, MessageCircle, UserPlus, X } from "lucide-react";
import Link from "next/link";
import type React from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";
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
  AMPLIFY: {
    action: "amplified your post",
    badgeClass: "bg-gradient-to-b from-[#fb7185] to-[#e11d48]",
    href: (notification) => `/posts/${notification.postId}`,
    icon: Heart,
  },
  COMMENT: {
    action: "eddied on your post",
    badgeClass: "bg-gradient-to-b from-[#38bdf8] to-[#0284c7]",
    href: (notification) => `/posts/${notification.postId}`,
    icon: MessageCircle,
  },
  FOLLOW: {
    action: "followed you",
    badgeClass: "bg-gradient-to-b from-[#ff9500] to-[#e65500]",
    href: (notification) => `/users/${notification.issuer.username}`,
    icon: UserPlus,
  },
  MENTION: {
    action: "mentioned you",
    badgeClass: "bg-gradient-to-b from-[#a78bfa] to-[#7c3aed]",
    href: (notification) => `/posts/${notification.postId}`,
    icon: AtSign,
  },
};

export default function Notification({ notification }: NotificationProps) {
  const config = TYPE_CONFIG[notification.type];
  const Icon = config.icon;
  const href = config.href(notification);
  const queryClient = useQueryClient();

  const { mutate: dismiss } = useMutation({
    mutationFn: () =>
      kyInstance.delete(`/api/notifications/${notification.id}`),
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
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
              {notification.post.content}
            </p>
          ) : null}

          <span className="text-muted-foreground/70 mt-1 block text-xs">
            {formatRelativeDate(notification.createdAt)}
          </span>
        </div>
      </Link>

      <button
        aria-label="Dismiss notification"
        className="icon-btn-3d mt-1 flex h-7 w-7 shrink-0 items-center justify-center opacity-0 transition-all duration-150 outline-none group-hover:opacity-100 focus-visible:opacity-100"
        onClick={handleDismiss}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
