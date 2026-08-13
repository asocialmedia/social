"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { PopularOnHackerNews } from "@/components/home/sidebars/right/popular-on-hackernews";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import { useFollowStates } from "@/hooks/use-follow-states";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";
import { APPLE_CARD_CLASS, ROW_HOVER_CLASS } from "./right/sidebar-styles";

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
      <h2 className="font-semibold text-sm">{title}</h2>
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

const RightSideBar: React.FC = () => {
  const { data: suggested, refetch } = useQuery({
    queryKey: ["suggested-connections-sidebar"],
    queryFn: () =>
      kyInstance.get("/api/users/suggested?limit=4").json<UserData[]>(),
    staleTime: 5 * 60 * 1000,
  });

  const suggestedUsers = suggested || [];
  const { data: followStates } = useFollowStates(
    suggestedUsers.map((user) => user.id)
  );

  return (
    <aside className="hide-native-scrollbar sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-border/60 border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <PopularOnHackerNews />

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
                <span className="block truncate text-muted-foreground text-xs transition-colors group-hover:text-inherit">
                  @{user.username}
                </span>
              </Link>
              <FollowButton
                className="follow-btn-3d h-8 shrink-0 px-3 text-xs"
                initialState={{
                  followers:
                    followStates?.[user.id]?.followers ?? user._count.followers,
                  isFollowedByUser:
                    followStates?.[user.id]?.isFollowedByUser ?? false,
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
};

export default RightSideBar;
