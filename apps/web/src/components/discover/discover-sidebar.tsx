"use client";

import { Compass, Flame, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const DiscoverySidebar = () => {
  const pathname = usePathname();
  const navItems = [
    {
      icon: Sparkles,
      label: "Suggested for you",
      href: "/discover",
    },
    {
      icon: Flame,
      label: "Trending",
      href: "/discover/trending",
    },
    {
      icon: Users,
      label: "New Users",
      href: "/discover/new",
    },
    {
      icon: Compass,
      label: "Browse All",
      href: "/discover/browse",
    },
  ];

  return (
    <div className="sidebar-subcard rounded-2xl p-2">
      <h2 className="flex items-center gap-2 px-2 pt-0.5 pb-1 font-semibold text-sm">
        <Compass className="h-4 w-4 shrink-0 text-muted-foreground" />
        Discover
      </h2>
      <nav className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                isActive
                  ? "pill-nav-active"
                  : "sidebar-row-hover text-muted-foreground hover:text-inherit"
              )}
              href={item.href}
              key={item.href}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default DiscoverySidebar;
