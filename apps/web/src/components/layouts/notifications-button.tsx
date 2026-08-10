"use client";
import type { NotificationCountInfo } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
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
    queryKey: ["unread-notification-count"],
    queryFn: () =>
      kyInstance
        .get("/api/notifications/unread-count")
        .json<NotificationCountInfo>(),
    initialData: initialState,
    refetchInterval: 60 * 1000,
  });

  const pathname = usePathname();
  const isActive = pathname.startsWith("/notifications");

  if (mode === "mobile") {
    return (
      <Button
        asChild
        className="h-10 rounded-xl border border-border/50 bg-card/70 px-2 py-1.5 shadow-xs backdrop-blur-md hover:bg-card/80"
        variant="ghost"
      >
        <a className="relative flex items-center" href="/notifications">
          <Bell
            className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
          />
          {data.unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {data.unreadCount}
            </span>
          )}
        </a>
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
            <span className="pointer-events-none absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
          )}
        </>
      }
      title="Notifications"
    />
  );
}
