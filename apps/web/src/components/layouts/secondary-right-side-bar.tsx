"use client";

import Link from "next/link";
import type React from "react";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";

const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
];

const SecondaryRightSideBar: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => (
  <aside className="hide-native-scrollbar sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-border/60 border-l px-5 pt-2.5 pb-6 xl:flex">
    <div className="flex flex-col gap-4">
      {children}
      <TrendingTopics />
      <footer className="flex flex-wrap gap-x-3 gap-y-1 px-3 pt-1 text-muted-foreground text-xs">
        <span>© {new Date().getFullYear()} Asocialmedia</span>
        {FOOTER_LINKS.map(({ href, label }) => (
          <Link
            className="transition-colors hover:text-foreground"
            href={href}
            key={label}
            target={href.startsWith("http") ? "_blank" : undefined}
          >
            {label}
          </Link>
        ))}
      </footer>
    </div>
  </aside>
);

export default SecondaryRightSideBar;
