"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import asmLogo from "@assets/asm.png";
import {
  Bell,
  Bookmark,
  Clapperboard,
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
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { cn, isRouteActive } from "@/lib/utils";
import { useComposerStore } from "@/store/composer-store";

import UserProfilePopover from "./left/user-profile-popover";

interface LeftSidebarProps {
  userData: UserData | null;
}

interface NavItem {
  count?: number;
  href: string;
  icon: typeof Home;
  label: string;
  requiresAuth?: boolean;
}

const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/discover", icon: Compass, label: "Explore" },
  { href: "/gusts", icon: Clapperboard, label: "Gusts" },
  { href: "/soon?feature=communities", icon: Users, label: "Communities" },
  {
    href: "/bookmarks",
    icon: Bookmark,
    label: "Bookmarks",
    requiresAuth: true,
  },
];

const SECONDARY_ITEMS: NavItem[] = [
  {
    href: "/notifications",
    icon: Bell,
    label: "Notifications",
    requiresAuth: true,
  },
  { href: "/soon?feature=messages", icon: MessagesSquare, label: "Messages" },
  {
    href: "/hackernews",
    icon: Compass,
    label: "HackerNews",
    requiresAuth: true,
  },
];

// Logged-in users get the live profile popover; guests never reach this
// component because LeftSidebar only renders it when userData is present.
const SidebarUserArea: React.FC<{ userData: UserData }> = ({ userData }) => {
  const { data: liveUserData } = useUserDataQuery(userData);
  return <UserProfilePopover userData={liveUserData} />;
};

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
  const isLoggedIn = Boolean(user);
  const { goToLogin } = useRequireAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
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

  const primaryItems = PRIMARY_ITEMS;
  const secondaryItems = SECONDARY_ITEMS;

  const renderItem = ({
    count,
    href,
    label,
    icon: Icon,
    requiresAuth,
  }: NavItem) => {
    const className = cn(
      "group flex w-full items-center gap-3 rounded-full border border-transparent px-3 py-2.5 text-left text-base transition-all duration-200 ease-out",
      isRouteActive(currentHref, href)
        ? "pill-nav-active"
        : "pill-3d-hover text-foreground hover:text-foreground"
    );

    const inner = (
      <>
        <Icon className="h-6 w-6 shrink-0" />
        <span className="min-w-0 flex-1">{label}</span>
        {count !== undefined && count > 0 ? (
          <span className="border-border/60 bg-muted/50 text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
            {count}
          </span>
        ) : null}
      </>
    );

    if (requiresAuth && !isLoggedIn) {
      return (
        <button
          className={className}
          key={href}
          onClick={goToLogin}
          type="button"
        >
          {inner}
        </button>
      );
    }

    return (
      <Link className={className} href={href} key={href}>
        {inner}
      </Link>
    );
  };

  const profileItem: NavItem = {
    href: user ? `/users/${user.username}` : "",
    icon: User,
    label: "Profile",
    requiresAuth: true,
  };

  const settingsItem: NavItem = {
    href: "/settings",
    icon: Settings,
    label: "Settings",
    requiresAuth: true,
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
        {primaryItems.map((item) => {
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

        {secondaryItems.map((item) =>
          renderItem(
            item.href === "/notifications"
              ? {
                  ...item,
                  count: unreadNotificationCount?.unreadCount ?? 0,
                }
              : item
          )
        )}

        {renderItem(profileItem)}

        {renderItem(settingsItem)}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        {isLoggedIn ? (
          <Button
            className="h-12 w-full rounded-full px-6 py-3"
            onClick={handleOpenComposer}
            variant="premium"
          >
            <PenSquare className="mr-1 h-5.5! w-5.5!" />
            <span>Create Post</span>
          </Button>
        ) : null}

        <div className="flex items-stretch gap-2">
          {userData ? <SidebarUserArea userData={userData} /> : null}

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
