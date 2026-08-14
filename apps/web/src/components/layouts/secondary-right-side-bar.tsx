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
  <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
    <div className="flex flex-col gap-4">
      {children}
      <TrendingTopics />
      <footer className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 px-3 pt-1 text-xs">
        <span>© {new Date().getFullYear()} Asocialmedia</span>
        {FOOTER_LINKS.map(({ href, label }) => (
          <Link
            className="hover:text-foreground transition-colors"
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
