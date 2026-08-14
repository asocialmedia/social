"use client";

import { Bell, Bookmark, Compass, Home, LogIn, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useBookmarkCount } from "@/hooks/use-bookmark-count";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import { cn, formatNumber, isRouteActive } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/discover", icon: Compass, label: "Explore" },
  { href: "/notifications", icon: Bell, label: "Notifications" },
  { href: "/bookmarks", icon: Bookmark, label: "Bookmarks" },
] as const;

const GUEST_NAV_ITEMS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/discover", icon: Compass, label: "Explore" },
] as const;

const countFor = (
  href: string,
  counts: { bookmarkCount?: number; unreadCount?: number }
) => {
  if (href === "/bookmarks") {
    return counts.bookmarkCount;
  }
  if (href === "/notifications") {
    return counts.unreadCount;
  }
};

const formatCount = (count: number) =>
  count > 99 ? "99+" : formatNumber(count);

const MobileBottomNav: React.FC = () => {
  const pathname = usePathname();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const { data: bookmarkData } = useBookmarkCount();
  const { data: notificationData } = useUnreadNotificationCount();
  const { openSpotlight } = useSpotlight();
  const handleOpenSpotlight = () => openSpotlight();

  const counts = {
    bookmarkCount: bookmarkData?.totalCount ?? 0,
    unreadCount: notificationData?.unreadCount ?? 0,
  };

  const renderNavItem = (
    href: string,
    label: string,
    Icon: typeof Home,
    count?: number
  ) => {
    const isActive = isRouteActive(pathname, href);

    if (href === "/search") {
      return (
        <button
          aria-label="Search"
          className={cn(
            "group text-muted-foreground relative flex flex-col items-center justify-center gap-0 justify-self-center rounded-full border-0 px-4 py-1 text-[10px] transition-all duration-200 ease-out outline-none hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
          )}
          key={href}
          onClick={handleOpenSpotlight}
          type="button"
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </button>
      );
    }

    return (
      <Link
        className={cn(
          "group text-muted-foreground relative flex flex-col items-center justify-center gap-0 justify-self-center rounded-full border-0 px-4 py-1 text-[10px] transition-all duration-200 ease-out outline-none hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
          isActive &&
            "bg-gradient-to-b from-[#ff9500] to-[#e65500] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
        )}
        href={href}
        key={href}
      >
        <span className="relative">
          <Icon className="h-5 w-5" />
          {count !== undefined && count > 0 ? (
            <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-[hsl(var(--background-alt))] bg-gradient-to-b from-[#ff9500] to-[#e65500] px-1 text-[9px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.2)]">
              {formatCount(count)}
            </span>
          ) : null}
        </span>
        <span className={cn(isActive && "font-semibold")}>{label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="border-border/60 fixed inset-x-0 bottom-0 z-50 border-t bg-[hsl(var(--background-alt))]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div
        className={cn(
          "grid gap-1 px-2 py-1.5",
          isLoggedIn ? "grid-cols-5" : "grid-cols-4"
        )}
      >
        {isLoggedIn
          ? NAV_ITEMS.map(({ href, label, icon: Icon }) =>
              renderNavItem(href, label, Icon, countFor(href, counts))
            )
          : GUEST_NAV_ITEMS.map(({ href, label, icon: Icon }) =>
              renderNavItem(href, label, Icon)
            )}
        {isLoggedIn ? null : (
          <Link
            aria-label="Log in"
            className="group text-muted-foreground relative flex flex-col items-center justify-center gap-0 justify-self-center rounded-full border-0 px-4 py-1 text-[10px] font-semibold transition-all duration-200 ease-out outline-none hover:bg-gradient-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
            href="/login"
          >
            <span className="relative">
              <LogIn className="h-5 w-5" />
            </span>
            <span className="text-primary font-semibold">Log in</span>
          </Link>
        )}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
