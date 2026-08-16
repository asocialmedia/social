"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import asmLogo from "@assets/asm.png";
import {
  Bell,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Compass,
  Home,
  MessagesSquare,
  Moon,
  PenSquare,
  Search,
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
import { LinkStatusHint } from "@/components/layouts/link-status-hint";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useBookmarkCount } from "@/hooks/use-bookmark-count";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { useUnreadMessageCount } from "@/lib/messages/use-unread-messages";
import { cn, isRouteActive } from "@/lib/utils";
import { useComposerStore } from "@/store/composer-store";
import { useSidebarStore } from "@/store/sidebar-store";

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
  {
    href: "/messages",
    icon: MessagesSquare,
    label: "Messages",
    requiresAuth: true,
  },
  {
    href: "/hackernews",
    icon: Compass,
    label: "HackerNews",
    requiresAuth: true,
  },
];

// Logged-in users get the live profile popover; guests never reach this
// component because LeftSidebar only renders it when userData is present.
const SidebarUserArea: React.FC<{
  compact?: boolean;
  userData: UserData;
}> = ({ compact, userData }) => {
  const { data: liveUserData } = useUserDataQuery(userData);
  return <UserProfilePopover compact={compact} userData={liveUserData} />;
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

const renderCollapsedActionItem = ({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Home;
  onClick: () => void;
}) => (
  <Tooltip key={label}>
    <TooltipTrigger asChild>
      <button
        aria-label={label}
        className="pill-3d-hover text-foreground hover:text-foreground group flex size-10 items-center justify-center rounded-full border border-transparent transition-all duration-200 ease-out"
        onClick={onClick}
        type="button"
      >
        <Icon className="h-5 w-5 shrink-0" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="tooltip-3d" side="right" sideOffset={12}>
      {label}
    </TooltipContent>
  </Tooltip>
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
  const unreadMessageCount = useUnreadMessageCount();
  const { openSpotlight } = useSpotlight();
  const openComposer = useComposerStore((state) => state.openComposer);
  const { isCollapsed, toggleCollapsed } = useSidebarStore();

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

  const withSecondaryCount = useCallback(
    (item: NavItem): NavItem => {
      if (item.href === "/notifications") {
        return { ...item, count: unreadNotificationCount?.unreadCount ?? 0 };
      }
      if (item.href === "/messages") {
        return { ...item, count: unreadMessageCount };
      }
      return item;
    },
    [unreadMessageCount, unreadNotificationCount]
  );

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
        <LinkStatusHint className="text-primary" />
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

  const renderCollapsedItem = ({
    count,
    href,
    label,
    icon: Icon,
    requiresAuth,
  }: NavItem) => {
    const className = cn(
      "group relative flex size-10 items-center justify-center rounded-full border border-transparent transition-all duration-200 ease-out",
      isRouteActive(currentHref, href)
        ? "pill-nav-active"
        : "pill-3d-hover text-foreground hover:text-foreground"
    );

    const icon = (
      <>
        <Icon className="h-5 w-5 shrink-0" />
        {count !== undefined && count > 0 ? (
          <span className="border-border/60 bg-muted/50 text-muted-foreground absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-semibold tabular-nums">
            {count}
          </span>
        ) : null}
      </>
    );

    const inner =
      requiresAuth && !isLoggedIn ? (
        <button
          aria-label={label}
          className={className}
          onClick={goToLogin}
          type="button"
        >
          {icon}
        </button>
      ) : (
        <Link aria-label={label} className={className} href={href}>
          {icon}
        </Link>
      );

    return (
      <Tooltip key={href}>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent className="tooltip-3d" side="right" sideOffset={12}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const profileItem: NavItem = {
    href: user ? `/users/${user.username}` : "",
    icon: User,
    label: "Profile",
    requiresAuth: true,
  };

  const themeToggleButton = (
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
  );

  if (isCollapsed) {
    return (
      <aside className="border-border/60 sticky top-0 hidden h-screen w-16 shrink-0 flex-col items-center border-r py-5 transition-[width] duration-300 ease-in-out lg:flex">
        <TooltipProvider delayDuration={0}>
          {/* Top-pinned: expand sidebar toggle */}
          <div className="flex shrink-0 flex-col items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Expand sidebar"
                  className="icon-btn-3d flex size-10 items-center justify-center rounded-full"
                  onClick={toggleCollapsed}
                  type="button"
                >
                  <ChevronRight className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="tooltip-3d"
                side="right"
                sideOffset={12}
              >
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          </div>

          {/* All options vertically centered as an icon rail */}
          <div className="hide-native-scrollbar flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto">
            <div className="my-auto flex w-full flex-col items-center gap-1.5 py-4">
              {/* App icon */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    aria-label="asocialmedia home"
                    className="mb-3 block"
                    href="/"
                  >
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
                </TooltipTrigger>
                <TooltipContent
                  className="tooltip-3d"
                  side="right"
                  sideOffset={12}
                >
                  Home
                </TooltipContent>
              </Tooltip>

              <nav className="flex flex-col items-center gap-1.5">
                {primaryItems.map((item) => {
                  if (item.href === "/search") {
                    return renderCollapsedActionItem({
                      icon: item.icon,
                      label: item.label,
                      onClick: () => openSpotlight(),
                    });
                  }

                  return renderCollapsedItem(
                    item.href === "/bookmarks"
                      ? { ...item, count: bookmarkCount?.totalCount }
                      : item
                  );
                })}
              </nav>

              <Separator className="bg-border/60 my-3 w-8" />

              <nav className="flex flex-col items-center gap-1.5">
                {secondaryItems.map((item) =>
                  renderCollapsedItem(withSecondaryCount(item))
                )}

                {isLoggedIn ? renderCollapsedItem(profileItem) : null}
              </nav>

              {userData ? (
                <SidebarUserArea compact userData={userData} />
              ) : null}
            </div>
          </div>

          {/* Bottom-pinned: Create Post above the theme toggle */}
          <div className="mt-2 flex shrink-0 flex-col items-center gap-2">
            {isLoggedIn ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Create Post"
                    className="follow-btn-3d flex size-10 items-center justify-center"
                    onClick={handleOpenComposer}
                    type="button"
                  >
                    <PenSquare className="size-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  className="tooltip-3d"
                  side="right"
                  sideOffset={12}
                >
                  Create Post
                </TooltipContent>
              </Tooltip>
            ) : null}
            {themeToggleButton}
          </div>
        </TooltipProvider>
      </aside>
    );
  }

  return (
    <aside className="border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r px-5 pt-2.5 pb-5 transition-[width] duration-300 ease-in-out lg:flex">
      <div className="mb-8 flex items-center justify-between gap-2 px-2">
        <Link href="/">
          <div className="relative h-11 w-14.5">
            <Image
              alt="asocialmedia"
              className="object-contain"
              fill
              loading="eager"
              sizes="58px"
              src={asmLogo}
            />
          </div>
        </Link>
        <button
          aria-label="Collapse sidebar"
          className="icon-btn-3d flex size-9 items-center justify-center rounded-full"
          onClick={toggleCollapsed}
          type="button"
        >
          <ChevronLeft className="size-4.5" />
        </button>
      </div>

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

        {secondaryItems.map((item) => renderItem(withSecondaryCount(item)))}

        {renderItem(profileItem)}
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

          {themeToggleButton}
        </div>
      </div>
    </aside>
  );
};

export default LeftSidebar;
