"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import asmLogo from "@assets/asm.png";
import { useQuery } from "@tanstack/react-query";
import { Bell, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserProfilePopover from "@/components/home/sidebars/left/user-profile-popover";
import UserAvatar from "@/components/layouts/user-avatar";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

const MobileTopBar: React.FC = () => {
  const { user } = useSession();
  const { openSpotlight } = useSpotlight();
  const { data: notificationData } = useUnreadNotificationCount();

  const unreadCount = notificationData?.unreadCount ?? 0;

  const { data: userData } = useQuery({
    enabled: Boolean(user),
    queryFn: () => kyInstance.get(`/api/users/${user?.id}`).json<UserData>(),
    queryKey: ["user", user?.id],
    staleTime: 1000 * 60 * 5,
  });

  const profileTrigger = () => {
    if (!user) {
      return null;
    }
    if (userData) {
      return <UserProfilePopover compact userData={userData} />;
    }
    return (
      <Link className="shrink-0" href={`/users/${user.username}`}>
        <UserAvatar
          avatarUrl={user.avatarUrl ?? user.image}
          className="h-10 w-10"
          priority
        />
      </Link>
    );
  };

  return (
    <div className="border-border/60 relative flex items-center gap-2 border-b px-3 py-2 md:hidden">
      <div className="flex w-10 shrink-0 items-center">{profileTrigger()}</div>

      {/* Out of flow and pinned to the bar's own centerline: the side columns
          have different widths, so centering within the leftover space would
          keep the logo off-center relative to the full-width bar. */}
      <Link className="absolute left-1/2 shrink-0 -translate-x-1/2" href="/">
        <div className="relative h-9 w-12">
          <Image
            alt="asocialmedia"
            className="object-contain"
            fill
            loading="eager"
            sizes="48px"
            src={asmLogo}
          />
        </div>
      </Link>

      <div
        className={cn(
          "ml-auto flex shrink-0 items-center justify-end gap-2",
          user ? "w-22" : "w-10"
        )}
      >
        {user ? (
          <>
            <Link
              aria-label="Notifications"
              className="icon-btn-3d flex h-9 w-9 items-center justify-center rounded-full transition-all! duration-300! ease-out! hover:scale-105 active:scale-95"
              href="/notifications"
            >
              <span className="relative">
                <Bell className="size-5" />
                {unreadCount > 0 ? (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-[hsl(var(--background-alt))] bg-gradient-to-b from-[#ff9500] to-[#e65500] px-1 text-[9px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.2)]">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </span>
            </Link>
            <button
              aria-label="Search"
              className="icon-btn-3d flex h-9 w-9 items-center justify-center rounded-full transition-all! duration-300! ease-out! hover:scale-105 active:scale-95"
              onClick={() => openSpotlight()}
              type="button"
            >
              <Search className="size-5" />
            </button>
          </>
        ) : (
          <Button
            asChild
            className="h-8 rounded-full px-3.5 text-xs font-semibold"
            variant="premium"
          >
            <Link href="/login">Log in</Link>
          </Button>
        )}
      </div>
    </div>
  );
};

export default MobileTopBar;
