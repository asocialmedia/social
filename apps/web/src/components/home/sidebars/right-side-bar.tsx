"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import Link from "next/link";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import PostHistoryCard from "@/components/posts/post-history-card";
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
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

const RightSideBar: React.FC = () => {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);

  const { data: suggested, refetch } = useQuery({
    enabled: isLoggedIn,
    queryFn: () =>
      kyInstance.get("/api/users/suggested?limit=4").json<UserData[]>(),
    queryKey: ["suggested-connections-sidebar"],
    staleTime: 5 * 60 * 1000,
  });

  const suggestedUsers = suggested || [];
  const { data: followStates } = useFollowStates(
    suggestedUsers.map((suggestedUser) => suggestedUser.id)
  );

  return (
    <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <TrendingTopics />

        <SubCard
          icon={
            <UserRound className="text-muted-foreground h-4 w-4 shrink-0" />
          }
          title="Who to follow"
        >
          {isLoggedIn ? (
            <>
              {" "}
              {suggestedUsers.slice(0, 4).map((suggestedUser) => (
                <div
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-2.5 py-2",
                    ROW_HOVER_CLASS
                  )}
                  key={suggestedUser.id}
                >
                  <Link href={`/users/${suggestedUser.username}`}>
                    <UserAvatar
                      avatarUrl={suggestedUser.avatarUrl}
                      className="h-8 w-8"
                    />
                  </Link>
                  <Link
                    className="min-w-0 flex-1"
                    href={`/users/${suggestedUser.username}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-sm font-medium">
                        {suggestedUser.displayName || suggestedUser.username}
                      </span>
                      <UserBadge badge={suggestedUser.badge} />
                    </span>
                    <span className="text-muted-foreground block truncate text-xs transition-colors group-hover:text-inherit">
                      @{suggestedUser.username}
                    </span>
                  </Link>
                  <FollowButton
                    className="h-8 shrink-0 px-3 text-xs"
                    initialState={{
                      followers:
                        followStates?.[suggestedUser.id]?.followers ??
                        suggestedUser._count.followers,
                      isFollowedByUser:
                        followStates?.[suggestedUser.id]?.isFollowedByUser ??
                        false,
                    }}
                    onFollowed={refetch}
                    userId={suggestedUser.id}
                  />
                </div>
              ))}
              {suggestedUsers.length === 0 ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  No suggestions right now.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              Sign in to see suggestions for people to follow.
            </p>
          )}
        </SubCard>

        {isLoggedIn ? (
          <PostHistoryCard />
        ) : (
          <AuthPromptCard
            description="Create an account to unlock the full asocialmedia experience."
            imageSize={72}
            title="Get your account"
          />
        )}

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

export default RightSideBar;
