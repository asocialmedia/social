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
import { usePathname } from "next/navigation";
import type React from "react";
import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn } from "@/lib/utils";

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
  { href: "/soon", label: "Communities", icon: Users },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
];

const SECONDARY_ITEMS: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/soon", label: "Messages", icon: MessagesSquare },
  { href: "/hackernews", label: "HackerNews", icon: Compass },
];

const LeftSidebar: React.FC<LeftSidebarProps> = ({ userData }) => {
  const pathname = usePathname();
  const { user } = useSession();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const renderItem = ({ href, label, icon: Icon }: NavItem) => (
    <Link
      className={cn(
        "flex items-center gap-3 rounded-full px-3 py-2.5 text-base transition-all duration-200 hover:bg-muted/60",
        isActive(href) && "bg-primary/10 font-semibold text-primary"
      )}
      href={href}
      key={href}
    >
      <Icon className="h-6 w-6 shrink-0" />
      <span>{label}</span>
    </Link>
  );

  return (
    <aside className="fixed top-0 left-0 hidden h-screen w-56 flex-col border-border/60 border-r px-3 py-5 lg:flex">
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

        {user ? (
          <Link
            className={cn(
              "flex items-center gap-3 rounded-full px-3 py-2.5 text-base transition-all duration-200 hover:bg-muted/60",
              isActive(`/users/${user.username}`) &&
                "bg-primary/10 font-semibold text-primary"
            )}
            href={`/users/${user.username}`}
          >
            <User className="h-6 w-6 shrink-0" />
            <span>Profile</span>
          </Link>
        ) : null}

        <Link
          className={cn(
            "flex items-center gap-3 rounded-full px-3 py-2.5 text-base transition-all duration-200 hover:bg-muted/60",
            isActive("/settings") && "bg-primary/10 font-semibold text-primary"
          )}
          href="/settings"
        >
          <Settings className="h-6 w-6 shrink-0" />
          <span>Settings</span>
        </Link>
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Button asChild className="h-11 w-full rounded-full" variant="premium">
          <Link href="/compose">
            <PenSquare className="mr-2 h-5 w-5" />
            Create Post
          </Link>
        </Button>

        <Link
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
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
