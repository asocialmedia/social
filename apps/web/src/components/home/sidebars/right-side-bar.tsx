"use client";

import type { HNStory } from "@asm/aggregator/hackernews";
import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Flame, UserRound } from "lucide-react";
import Link from "next/link";
import type React from "react";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";

const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
];

const ROW_HOVER_CLASS =
  "outline-none transition-all duration-200 ease-out hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

const APPLE_CARD_CLASS =
  "rounded-2xl border border-white/10 bg-[hsl(var(--background-alt))] p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_2px_rgba(255,255,255,0.06),inset_0_-2px_4px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.06)]";

const HackerNewsLogo: React.FC<{ className?: string }> = ({ className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex shrink-0 items-center justify-center rounded-md bg-orange-500 font-bold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_1px_1px_rgba(0,0,0,0.15)]",
      className
    )}
  >
    Y
  </span>
);

const SubCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ children, icon, title }) => (
  <div className={APPLE_CARD_CLASS}>
    <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
      {icon}
      <h2 className="font-semibold text-sm">{title}</h2>
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

const RightSideBar: React.FC = () => {
  const { data: hnStories } = useQuery({
    queryKey: ["hn-top-stories"],
    queryFn: async () => {
      const res = await fetch("/api/hackernews?limit=6&sort=score");
      if (!res.ok) {
        throw new Error(`Failed to fetch Hacker News stories: ${res.status}`);
      }
      return res.json() as Promise<{ stories: HNStory[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: suggested, refetch } = useQuery({
    queryKey: ["suggested-connections-sidebar"],
    queryFn: () =>
      kyInstance.get("/api/users/suggested?limit=4").json<UserData[]>(),
    staleTime: 5 * 60 * 1000,
  });

  const stories = hnStories?.stories || [];
  const suggestedUsers = suggested || [];

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-border/60 border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <SubCard
          icon={<HackerNewsLogo className="h-4 w-4 text-[10px]" />}
          title="Popular on HackerNews"
        >
          {stories.slice(0, 5).map((story) => {
            const storyHref =
              story.url || `https://news.ycombinator.com/item?id=${story.id}`;
            return (
              <div
                className={cn(
                  "group flex flex-col gap-0.5 rounded-lg px-2.5 py-2",
                  ROW_HOVER_CLASS
                )}
                key={story.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <a
                    className="line-clamp-2 font-medium text-sm"
                    href={storyHref}
                    rel="noopener noreferrer"
                    target={story.url ? "_blank" : undefined}
                  >
                    {story.title}
                  </a>
                  <a
                    aria-label={`Visit ${story.title}`}
                    className="mt-0.5 flex shrink-0 items-center gap-0.5 text-muted-foreground text-xs transition-colors group-hover:text-white/80"
                    href={storyHref}
                    rel="noopener noreferrer"
                    target={story.url ? "_blank" : undefined}
                  >
                    Visit
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <span className="flex items-center gap-1 pl-0 text-muted-foreground text-xs transition-colors group-hover:text-white/80">
                  <Flame className="h-3 w-3 text-orange-500 transition-colors group-hover:text-white/80" />
                  {formatNumber(story.score)} points
                </span>
              </div>
            );
          })}
          {stories.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground text-sm">
              No stories right now.
            </p>
          ) : null}
        </SubCard>

        <TrendingTopics />

        <SubCard
          icon={
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          }
          title="Who to follow"
        >
          {suggestedUsers.slice(0, 4).map((user) => (
            <div
              className={cn(
                "group flex items-center gap-3 rounded-lg px-2.5 py-2",
                ROW_HOVER_CLASS
              )}
              key={user.id}
            >
              <Link href={`/users/${user.username}`}>
                <UserAvatar avatarUrl={user.avatarUrl} className="h-8 w-8" />
              </Link>
              <Link className="min-w-0 flex-1" href={`/users/${user.username}`}>
                <span className="block truncate font-medium text-sm">
                  {user.displayName || user.username}
                </span>
                <span className="block truncate text-muted-foreground text-xs transition-colors group-hover:text-white/80">
                  @{user.username}
                </span>
              </Link>
              <FollowButton
                className="h-8 shrink-0 bg-gradient-to-b! from-[#ff9500] to-[#e65500] px-3 text-white text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]! hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
                initialState={{
                  followers: user._count.followers,
                  isFollowedByUser: false,
                }}
                onFollowed={refetch}
                userId={user.id}
              />
            </div>
          ))}
          {suggestedUsers.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground text-sm">
              No suggestions right now.
            </p>
          ) : null}
        </SubCard>
      </div>

      <footer className="mt-auto flex flex-wrap gap-x-3 gap-y-1 px-3 pt-6 text-muted-foreground text-xs">
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
    </aside>
  );
};

export default RightSideBar;
