"use client";
import type { NotificationCountInfo } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { HeaderIconButton } from "@/components/styles/header-buttons";
import kyInstance from "@/lib/ky";

interface NotificationsButtonProps {
  initialState: NotificationCountInfo;
  mode?: "desktop" | "mobile";
}

export default function NotificationsButton({
  initialState,
  mode = "desktop",
}: NotificationsButtonProps) {
  const { data } = useQuery({
    initialData: initialState,
    queryFn: () =>
      kyInstance
        .get("/api/notifications/unread-count")
        .json<NotificationCountInfo>(),
    queryKey: ["unread-notification-count"],
    refetchInterval: 60 * 1000,
  });

  const pathname = usePathname();
  const isActive = pathname.startsWith("/notifications");

  if (mode === "mobile") {
    return (
      <Button
        asChild
        className="border-border/50 bg-card/70 hover:bg-card/80 h-10 rounded-xl border px-2 py-1.5 shadow-xs backdrop-blur-md"
        variant="ghost"
      >
        <Link className="relative flex items-center" href="/notifications">
          <Bell
            className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
          />
          {data.unreadCount > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px]">
              {data.unreadCount}
            </span>
          )}
        </Link>
      </Button>
    );
  }

  return (
    <HeaderIconButton
      count={data.unreadCount}
      href="/notifications"
      icon={
        <>
          <Bell className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
          {isActive && (
            <span className="bg-primary pointer-events-none absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" />
          )}
        </>
      }
      title="Notifications"
    />
  );
}
