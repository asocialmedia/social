"use client";

import { Bell, Bookmark, Home, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
];

const MobileBottomNav: React.FC = () => {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-border/60 border-t bg-[hsl(var(--background-alt))]/95 backdrop-blur-md lg:hidden">
      <div className="grid grid-cols-4 px-2 py-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              className={cn(
                "flex flex-col items-center justify-center gap-0 rounded-full py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground",
                isActive && "bg-primary/10 text-primary"
              )}
              href={href}
              key={href}
            >
              <Icon className="h-5 w-5" />
              <span className={cn(isActive && "font-semibold")}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
