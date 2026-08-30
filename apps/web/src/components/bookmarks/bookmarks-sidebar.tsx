"use client";

import { Bookmark, Clapperboard, Newspaper, Terminal } from "lucide-react";
import Link from "next/link";
import type React from "react";

import SearchField from "@/components/layouts/search-field";
import PostHistoryCard from "@/components/posts/post-history-card";
import { formatNumber } from "@/lib/utils";

const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
];

interface BookmarksSidebarProps {
  gustBookmarkCount: number;
  hnBookmarkCount: number;
  postBookmarkCount: number;
}

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
}> = ({ icon, label, value }) => (
  <div className="bg-background/60 flex flex-col items-center rounded-xl px-1 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04)]">
    {icon}
    <span className="mt-1 bg-linear-to-b from-[#ff9500] to-[#e65500] bg-clip-text text-lg font-bold text-transparent tabular-nums">
      {formatNumber(value)}
    </span>
    <span className="text-muted-foreground mt-0.5 text-[11px]">{label}</span>
  </div>
);

const BookmarksSidebar: React.FC<BookmarksSidebarProps> = ({
  gustBookmarkCount,
  hnBookmarkCount,
  postBookmarkCount,
}) => {
  const totalBookmarks =
    postBookmarkCount + gustBookmarkCount + hnBookmarkCount;

  return (
    <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-visible border-l px-2.5 pt-2.5 pb-6 xl:flex">
      <div className="shrink-0 pb-4">
        <SearchField />
      </div>
      <div className="hide-native-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto">
        <div className="sidebar-subcard rounded-2xl p-2">
          <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
            <Bookmark className="text-muted-foreground h-4 w-4 shrink-0" />
            <h2 className="text-sm font-semibold">Your Bookmarks</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            <StatTile
              icon={<Newspaper className="text-muted-foreground h-4 w-4" />}
              label="Posts"
              value={postBookmarkCount}
            />
            <StatTile
              icon={<Clapperboard className="text-muted-foreground h-4 w-4" />}
              label="Gusts"
              value={gustBookmarkCount}
            />
            <StatTile
              icon={<Terminal className="text-muted-foreground h-4 w-4" />}
              label="HackerNews"
              value={hnBookmarkCount}
            />
            <StatTile
              icon={<Bookmark className="text-muted-foreground h-4 w-4" />}
              label="Total"
              value={totalBookmarks}
            />
          </div>
        </div>

        <PostHistoryCard />

        <footer className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 px-3 pt-1 text-xs">
          <span>© {new Date().getFullYear()} asocialmedia</span>
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
};

export default BookmarksSidebar;
