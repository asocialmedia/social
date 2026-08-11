"use client";

import type { HNStory } from "@asm/aggregator/hackernews";
import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type React from "react";
import SearchField from "@/components/layouts/search-field";
import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";

interface RightSideBarProps {
  userData: UserData;
}

const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
];

const RightSideBar: React.FC<RightSideBarProps> = ({ userData: _userData }) => {
  const { data: hnStories } = useQuery({
    queryKey: ["hn-top-stories"],
    queryFn: async () => {
      const res = await fetch("/api/hackernews?limit=6&sort=score");
      if (!res.ok) {
        return { stories: [] as HNStory[] };
      }
      return res.json() as Promise<{ stories: HNStory[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: suggested } = useQuery({
    queryKey: ["suggested-connections-sidebar"],
    queryFn: () =>
      kyInstance.get("/api/users/suggested?limit=4").json<UserData[]>(),
    staleTime: 5 * 60 * 1000,
  });

  const stories = hnStories?.stories || [];
  const suggestedUsers = suggested || [];

  return (
    <aside className="fixed top-0 right-0 hidden h-screen w-80 flex-col gap-6 overflow-y-auto px-6 py-6 xl:flex">
      <SearchField />

      <section>
        <div className="mb-3 flex items-center gap-1.5">
          <h2 className="font-semibold">Popular on HackerNews</h2>
          <HackerNewsIcon className="h-3.5 w-3.5" />
        </div>
        <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-[hsl(var(--background-alt))]">
          {stories.slice(0, 5).map((story, _index) => (
            <a
              className="flex flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-muted/40"
              href={story.url || undefined}
              key={story.id}
              rel="noopener noreferrer"
              target={story.url ? "_blank" : undefined}
            >
              <span className="line-clamp-2 font-medium text-sm">
                {story.title}
              </span>
              <span className="text-muted-foreground text-xs">
                {story.score} points
              </span>
            </a>
          ))}
          {stories.length === 0 ? (
            <p className="p-4 text-muted-foreground text-sm">
              No stories right now.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Who to follow</h2>
        <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-[hsl(var(--background-alt))]">
          {suggestedUsers.slice(0, 4).map((user) => (
            <Link
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              href={`/users/${user.username}`}
              key={user.id}
            >
              <UserAvatar avatarUrl={user.avatarUrl} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">
                  {user.displayName || user.username}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  @{user.username}
                </span>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            </Link>
          ))}
          {suggestedUsers.length === 0 ? (
            <p className="p-4 text-muted-foreground text-sm">
              No suggestions right now.
            </p>
          ) : null}
        </div>
      </section>

      <footer className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
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

function HackerNewsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 640 640"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M96 96L96 544L544 544L544 96L96 96zM117.2 293.2L117 293.2C117.1 293.1 117.2 292.9 117.3 292.8C117.3 292.9 117.3 293.1 117.2 293.2zM335.2 347.1L335.2 448L303.8 448L303.8 345.3L224 192L261.3 192C313.8 290.3 310.5 293.2 320.6 317.6C332.9 290.6 326.4 293.2 381.2 192L416 192L335.2 347.1z"
        fill="rgb(255, 91, 0)"
      />
    </svg>
  );
}

export default RightSideBar;
