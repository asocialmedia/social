"use client";

import type { HNApiResponse } from "@asm/aggregator/hackernews";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type React from "react";

import {
  HackerNewsLogo,
  PopularOnHackerNews,
} from "@/components/home/sidebars/right/popular-on-hackernews";
import { APPLE_CARD_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import PostHistoryCard from "@/components/posts/post-history-card";
import kyInstance from "@/lib/ky";
import { formatNumber } from "@/lib/utils";

const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
];

const SubCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ children, icon, title }) => (
  <div className={APPLE_CARD_CLASS}>
    <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
      {icon}
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

const HnRightSideBar: React.FC = () => {
  const { data } = useQuery({
    queryFn: () =>
      kyInstance
        .get("/api/hackernews", {
          searchParams: { limit: 10, sort: "score" },
        })
        .json<HNApiResponse>(),
    queryKey: ["hn-sidebar-stories"],
    staleTime: 5 * 60 * 1000,
  });

  const stories = data?.stories ?? [];
  const totalStories = data?.total ?? 0;
  const totalPoints = stories.reduce((acc, story) => acc + story.score, 0);
  const totalComments = stories.reduce(
    (acc, story) => acc + story.descendants,
    0
  );

  return (
    <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <SubCard
          icon={<HackerNewsLogo className="h-4 w-4 text-[10px]" />}
          title="HackerNews Stats"
        >
          <div className="grid grid-cols-3 gap-2 px-1 pt-1">
            <div className="bg-background/60 flex flex-col items-center rounded-xl px-1 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="bg-gradient-to-b from-[#ff9500] to-[#e65500] bg-clip-text text-lg font-bold text-transparent tabular-nums">
                {formatNumber(totalStories)}
              </span>
              <span className="text-muted-foreground mt-0.5 text-[11px]">
                Stories
              </span>
            </div>
            <div className="bg-background/60 flex flex-col items-center rounded-xl px-1 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="bg-gradient-to-b from-[#ff9500] to-[#e65500] bg-clip-text text-lg font-bold text-transparent tabular-nums">
                {formatNumber(totalPoints)}
              </span>
              <span className="text-muted-foreground mt-0.5 text-[11px]">
                Points
              </span>
            </div>
            <div className="bg-background/60 flex flex-col items-center rounded-xl px-1 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="bg-gradient-to-b from-[#ff9500] to-[#e65500] bg-clip-text text-lg font-bold text-transparent tabular-nums">
                {formatNumber(totalComments)}
              </span>
              <span className="text-muted-foreground mt-0.5 text-[11px]">
                Comments
              </span>
            </div>
          </div>
        </SubCard>

        <PopularOnHackerNews />

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

export default HnRightSideBar;
