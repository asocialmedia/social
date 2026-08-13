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
  Settings,
  Sun,
  User,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/app/(main)/session-provider";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { cn, isRouteActive } from "@/lib/utils";
import UserProfilePopover from "./left/user-profile-popover";

interface LeftSidebarProps {
  userData: UserData;
}

interface NavItem {
  href: string;
  icon: typeof Home;
  label: string;
}

const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Explore", icon: Compass },
  { href: "/soon?feature=communities", label: "Communities", icon: Users },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
];

const SECONDARY_ITEMS: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/soon?feature=messages", label: "Messages", icon: MessagesSquare },
  { href: "/hackernews", label: "HackerNews", icon: Compass },
];

const LeftSidebar: React.FC<LeftSidebarProps> = ({ userData }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { data: liveUserData } = useUserDataQuery(userData);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const queryString = searchParams.toString();
  const currentHref = queryString ? `${pathname}?${queryString}` : pathname;

  const renderItem = ({ href, label, icon: Icon }: NavItem) => (
    <Link
      className={cn(
        "group flex items-center gap-3 rounded-full border-0 px-3 py-2.5 text-base transition-all duration-200 ease-out",
        isRouteActive(currentHref, href)
          ? "pill-nav-active"
          : "pill-3d-hover text-foreground hover:text-foreground"
      )}
      href={href}
      key={href}
    >
      <Icon className="h-6 w-6 shrink-0" />
      <span>{label}</span>
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
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-border/60 border-r px-5 pt-2.5 pb-5 lg:flex">
      <Link className="mb-8 block px-2" href="/">
        <div className="relative h-12 w-12">
          <Image
            alt="Asocialmedia"
            className="object-contain"
            fill
            sizes="48px"
            src={asmLogo}
          />
        </div>
      </Link>

      <nav className="flex flex-col gap-1">
        {PRIMARY_ITEMS.map(renderItem)}

        <Separator className="my-3 bg-border/60" />

        {SECONDARY_ITEMS.map(renderItem)}

        {user ? renderItem(profileItem) : null}

        {renderItem(settingsItem)}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Button
          asChild
          className="h-12 w-full rounded-full px-6 py-3"
          variant="premium"
        >
          <Link href="/compose">
            <PenSquare className="mr-1 h-5.5! w-5.5!" />
            <span>Create Post</span>
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <UserProfilePopover userData={liveUserData} />

          <button
            aria-label={
              mounted && resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            className="pill-3d-hover group flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 text-muted-foreground"
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
