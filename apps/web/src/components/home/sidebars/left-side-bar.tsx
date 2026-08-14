"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import asmLogo from "@assets/asm.png";
import {
  Bell,
  Bookmark,
  Compass,
  Home,
  MessagesSquare,
  Moon,
  PenSquare,
  Search,
  Settings,
  Sun,
  User,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useBookmarkCount } from "@/hooks/use-bookmark-count";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { cn, isRouteActive } from "@/lib/utils";
import { useComposerStore } from "@/store/composer-store";

import UserProfilePopover from "./left/user-profile-popover";

interface LeftSidebarProps {
  userData: UserData;
}

interface NavItem {
  count?: number;
  href: string;
  icon: typeof Home;
  label: string;
}

const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/discover", icon: Compass, label: "Explore" },
  { href: "/soon?feature=communities", icon: Users, label: "Communities" },
  { href: "/bookmarks", icon: Bookmark, label: "Bookmarks" },
];

const SECONDARY_ITEMS: NavItem[] = [
  { href: "/notifications", icon: Bell, label: "Notifications" },
  { href: "/soon?feature=messages", icon: MessagesSquare, label: "Messages" },
  { href: "/hackernews", icon: Compass, label: "HackerNews" },
];

const renderActionItem = ({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Home;
  onClick: () => void;
}) => (
  <button
    className="group pill-3d-hover text-foreground hover:text-foreground flex w-full items-center gap-3 rounded-full border border-transparent px-3 py-2.5 text-left text-base transition-all duration-200 ease-out"
    key={label}
    onClick={onClick}
    type="button"
  >
    <Icon className="h-6 w-6 shrink-0" />
    <span className="min-w-0 flex-1">{label}</span>
  </button>
);

const LeftSidebar: React.FC<LeftSidebarProps> = ({ userData }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { data: liveUserData } = useUserDataQuery(userData);
  const { data: bookmarkCount } = useBookmarkCount();
  const { data: unreadNotificationCount } = useUnreadNotificationCount();
  const { openSpotlight } = useSpotlight();
  const openComposer = useComposerStore((state) => state.openComposer);

  useEffect(() => {
    // eslint-disable-next-line react-compiler -- mark the theme as hydrated after first render
    setMounted(true);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const handleOpenComposer = useCallback(() => {
    openComposer();
  }, [openComposer]);

  const queryString = searchParams.toString();
  const currentHref = queryString ? `${pathname}?${queryString}` : pathname;

  const renderItem = ({ count, href, label, icon: Icon }: NavItem) => (
    <Link
      className={cn(
        "group flex items-center gap-3 rounded-full border border-transparent px-3 py-2.5 text-base transition-all duration-200 ease-out",
        isRouteActive(currentHref, href)
          ? "pill-nav-active"
          : "pill-3d-hover text-foreground hover:text-foreground"
      )}
      href={href}
      key={href}
    >
      <Icon className="h-6 w-6 shrink-0" />
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className="border-border/60 bg-muted/50 text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
          {count}
        </span>
      ) : null}
    </Link>
  );

  const profileItem: NavItem = {
    href: user ? `/users/${user.username}` : "",
    icon: User,
    label: "Profile",
  };

  const settingsItem: NavItem = {
    href: "/settings",
    icon: Settings,
    label: "Settings",
  };

  return (
    <aside className="border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r px-5 pt-2.5 pb-5 lg:flex">
      <Link className="mb-8 block px-2" href="/">
        <div className="relative h-11 w-[58px]">
          <Image
            alt="Asocialmedia"
            className="object-contain"
            fill
            loading="eager"
            sizes="58px"
            src={asmLogo}
          />
        </div>
      </Link>

      <nav className="flex flex-col gap-1">
        {PRIMARY_ITEMS.map((item) => {
          if (item.href === "/search") {
            return renderActionItem({
              icon: item.icon,
              label: item.label,
              onClick: () => openSpotlight(),
            });
          }

          return renderItem(
            item.href === "/bookmarks"
              ? { ...item, count: bookmarkCount?.totalCount }
              : item
          );
        })}

        <Separator className="bg-border/60 my-3" />

        {SECONDARY_ITEMS.map((item) =>
          renderItem(
            item.href === "/notifications"
              ? {
                  ...item,
                  count: unreadNotificationCount?.unreadCount ?? 0,
                }
              : item
          )
        )}

        {user ? renderItem(profileItem) : null}

        {renderItem(settingsItem)}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Button
          className="h-12 w-full rounded-full px-6 py-3"
          onClick={handleOpenComposer}
          variant="premium"
        >
          <PenSquare className="mr-1 h-5.5! w-5.5!" />
          <span>Create Post</span>
        </Button>

        <div className="flex items-stretch gap-2">
          <UserProfilePopover userData={liveUserData} />

          <button
            aria-label={
              mounted && resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            className="pill-3d-hover group text-muted-foreground my-auto flex size-10 shrink-0 items-center justify-center self-center rounded-full border-0"
            onClick={handleToggleTheme}
            type="button"
          >
            {mounted && resolvedTheme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default LeftSidebar;
