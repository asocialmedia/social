"use client";

import type { HNStory } from "@asm/aggregator/hackernews";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Flame } from "lucide-react";
import type React from "react";

import { cn, formatNumber } from "@/lib/utils";

import { APPLE_CARD_CLASS, ROW_HOVER_CLASS } from "./sidebar-styles";

export const HackerNewsLogo: React.FC<{ className?: string }> = ({
  className,
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex shrink-0 items-center justify-center rounded-md bg-gradient-to-b from-[#ff9500] to-[#e65500] font-bold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_1px_2px_rgba(154,52,18,0.3)]",
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
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

export const PopularOnHackerNews = () => {
  const { data: hnStories } = useQuery({
    queryFn: async () => {
      const res = await fetch("/api/hackernews?limit=5&sort=score");
      if (!res.ok) {
        throw new Error(`Failed to fetch Hacker News stories: ${res.status}`);
      }
      return res.json() as Promise<{ stories: HNStory[] }>;
    },
    queryKey: ["hn-top-stories"],
    staleTime: 5 * 60 * 1000,
  });

  const stories = hnStories?.stories || [];

  return (
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
                className="line-clamp-2 text-sm font-medium"
                href={storyHref}
                rel="noopener noreferrer"
                target={story.url ? "_blank" : undefined}
              >
                {story.title}
              </a>
              <a
                aria-label={`Visit ${story.title}`}
                className="text-muted-foreground mt-0.5 flex shrink-0 items-center gap-0.5 text-xs transition-colors group-hover:text-inherit"
                href={storyHref}
                rel="noopener noreferrer"
                target={story.url ? "_blank" : undefined}
              >
                Visit
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <span className="text-muted-foreground flex items-center gap-1 pl-0 text-xs transition-colors group-hover:text-inherit">
              <Flame
                className={cn(
                  "h-3 w-3 transition-colors group-hover:text-inherit",
                  story.score < 0 ? "text-[#7c5cff]" : "text-orange-500"
                )}
              />
              {formatNumber(story.score)} points
            </span>
          </div>
        );
      })}
      {stories.length === 0 ? (
        <p className="text-muted-foreground px-3 py-2 text-sm">
          No stories right now.
        </p>
      ) : null}
    </SubCard>
  );
};
