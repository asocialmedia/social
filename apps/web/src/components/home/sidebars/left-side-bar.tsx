"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import {
  Bell,
  Bookmark,
  Compass,
  Home,
  MessagesSquare,
  PenSquare,
  Settings,
  User,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn, isRouteActive } from "@/lib/utils";

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

  const queryString = searchParams.toString();
  const currentHref = queryString ? `${pathname}?${queryString}` : pathname;

  const renderItem = ({ href, label, icon: Icon }: NavItem) => (
    <Link
      className={cn(
        "group flex items-center gap-3 rounded-full border-0 px-3 py-2.5 text-base outline-none transition-all duration-200 ease-out",
        isRouteActive(currentHref, href)
          ? "bg-gradient-to-b from-[#ff9500] to-[#e65500] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
          : "hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
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
        <Image
          alt="Asocialmedia"
          className="h-10 w-10"
          height={40}
          src="/asocialmedialogo.svg"
          width={40}
        />
      </Link>

      <nav className="flex flex-col gap-1">
        {PRIMARY_ITEMS.map(renderItem)}

        <Separator className="my-3 bg-border/60" />

        {SECONDARY_ITEMS.map(renderItem)}

        {user ? renderItem(profileItem) : null}

        {renderItem(settingsItem)}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Button asChild className="h-11 w-full rounded-full" variant="premium">
          <Link href="/compose">
            <PenSquare className="mr-2 h-5 w-5" />
            Create Post
          </Link>
        </Button>

        <Link
          className="group flex items-center gap-2.5 rounded-lg border-0 px-2 py-2 outline-none transition-all duration-200 ease-out hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
          href={`/users/${userData.username}`}
        >
          <UserAvatar avatarUrl={userData.avatarUrl} className="h-8 w-8" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-sm">
              {userData.displayName || userData.username}
            </span>
            <span className="block truncate text-muted-foreground text-xs">
              @{userData.username}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
};

export default LeftSidebar;
