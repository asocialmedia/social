"use client";

import type { UserData } from "@asm/db";
import { Bell, Home, Search, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn } from "@/lib/utils";

interface LeftSidebarProps {
  userData: UserData;
}

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

const LeftSidebar: React.FC<LeftSidebarProps> = ({ userData }) => {
  const pathname = usePathname();

  return (
    <aside className="fixed top-0 left-0 hidden h-screen w-52 flex-col border-border/60 border-r px-3 py-5 lg:flex">
      <Link className="mb-8 block px-2" href="/">
        <Image
          alt="Asocialmedia"
          className="h-10 w-10"
          height={40}
          src="/asocialmedialogo.svg"
          width={40}
        />
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted",
                isActive && "font-semibold text-primary"
              )}
              href={href}
              key={href}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <Link
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
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
