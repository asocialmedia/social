"use client";

import type { UserData } from "@asm/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, RefreshCw, Sparkles, UserRound, Users, X } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  action?: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ children, icon, title, action }) => (
  <div className={APPLE_CARD_CLASS}>
    <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
      {icon}
      <h2 className="flex-1 text-sm font-semibold">{title}</h2>
      {action}
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

type SuggestedUser = UserData & {
  mutualFollowers?: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  }[];
  _reasons?: string[];
};

function ReasonLine({
  reasons,
  mutualFollowers,
}: {
  reasons?: string[];
  mutualFollowers?: SuggestedUser["mutualFollowers"];
}) {
  const reason = reasons?.[0];
  if (!reason) {
    return null;
  }
  return (
    <span className="text-muted-foreground flex items-center gap-1 truncate text-[11px] leading-none">
      {mutualFollowers && mutualFollowers.length > 0 ? (
        <span className="flex -space-x-1.5">
          {mutualFollowers.slice(0, 3).map((m) => (
            <span
              key={m.username}
              className="ring-background rounded-full ring-2"
            >
              <UserAvatar avatarUrl={m.avatarUrl} className="h-4 w-4" />
            </span>
          ))}
        </span>
      ) : null}
      {!mutualFollowers?.length && reason.includes("Active") ? (
        <Clock className="h-3 w-3 shrink-0" />
      ) : null}
      {!mutualFollowers?.length && reason.includes("Popular") ? (
        <Sparkles className="h-3 w-3 shrink-0" />
      ) : null}
      {!mutualFollowers?.length && reason.includes("interest") ? (
        <Users className="h-3 w-3 shrink-0" />
      ) : null}
      <span className="truncate">{reason}</span>
    </span>
  );
}

interface WhoToFollowContentProps {
  followStates?: Record<
    string,
    { followers: number; isFollowedByUser: boolean }
  >;
  handleDismiss: (userId: string) => void;
  handleFollowed: (userId: string) => void;
  handleRefresh: () => void;
  isError: boolean;
  refetch: () => void;
  showEmpty: boolean;
  showSkeletons: boolean;
  suggestedUsers: SuggestedUser[];
  visibleUsers: SuggestedUser[];
}

const WhoToFollowContent: React.FC<WhoToFollowContentProps> = ({
  followStates,
  handleDismiss,
  handleFollowed,
  handleRefresh,
  isError,
  refetch,
  showEmpty,
  showSkeletons,
  suggestedUsers,
  visibleUsers,
}) => {
  if (showSkeletons) {
    return (
      <>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`sk-${i}`}
            className="flex items-center gap-3 rounded-lg px-2.5 py-2"
          >
            <div className="bg-muted h-8 w-8 animate-pulse rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="bg-muted h-3 w-24 animate-pulse rounded" />
              <div className="bg-muted h-3 w-16 animate-pulse rounded" />
            </div>
            <div className="bg-muted h-8 w-16 animate-pulse rounded-full" />
          </div>
        ))}
      </>
    );
  }

  if (isError) {
    return (
      <div className="px-3 py-4 text-center">
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t load suggestions
        </p>
        <button
          className="text-primary mt-2 text-xs hover:underline"
          onClick={() => refetch()}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  if (showEmpty) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
        <div className="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full">
          <Users className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">
          No suggestions yet, come back later
        </p>
        <p className="text-muted-foreground max-w-48 text-xs">
          Follow more people or post with tags to get personalized suggestions.
          We&apos;re finding fresh faces for you.
        </p>
        <button
          className="text-primary border-primary/20 hover:bg-accent mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
          onClick={handleRefresh}
          type="button"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
    );
  }

  return (
    <>
      {visibleUsers.map((suggestedUser) => (
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
              <UserBadge
                badge={suggestedUser.badge}
                badges={suggestedUser.badges}
              />
            </span>
            <span className="text-muted-foreground block truncate text-xs transition-colors group-hover:text-inherit">
              @{suggestedUser.username}
            </span>
            <ReasonLine
              reasons={suggestedUser._reasons}
              mutualFollowers={suggestedUser.mutualFollowers}
            />
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <FollowButton
              className="h-8 shrink-0 px-3 text-xs"
              initialState={{
                followers:
                  followStates?.[suggestedUser.id]?.followers ??
                  suggestedUser._count.followers,
                isFollowedByUser:
                  followStates?.[suggestedUser.id]?.isFollowedByUser ?? false,
              }}
              onFollowed={() => handleFollowed(suggestedUser.id)}
              userId={suggestedUser.id}
            />
            <button
              aria-label={`Dismiss ${suggestedUser.username}`}
              className="text-muted-foreground hover:text-foreground hover:bg-accent hidden h-7 w-7 items-center justify-center rounded-full group-hover:flex"
              onClick={() => handleDismiss(suggestedUser.id)}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      {suggestedUsers.length > 0 ? (
        <button
          className="text-muted-foreground hover:text-foreground px-2.5 py-2 text-left text-xs hover:underline"
          onClick={handleRefresh}
          type="button"
        >
          Show more
        </button>
      ) : null}
    </>
  );
};

const RightSideBar: React.FC = () => {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: suggested,
    refetch,
    isLoading,
    isError,
    isFetching,
  } = useQuery({
    enabled: isLoggedIn,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await kyInstance
        .get("/api/users/suggested?limit=6")
        .json<SuggestedUser[]>();
      return res;
    },
    queryKey: ["suggested-users"],
    retry: (failureCount, _err) => {
      const msg = String(_err);
      if (msg.includes("429")) {
        return false;
      }
      return failureCount < 2;
    },
    staleTime: 60 * 1000,
  });

  // Also listen for the legacy key invalidated by follow button for backwards compat
  useEffect(() => {
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      if (
        event?.query.queryKey[0] === "suggested-connections" ||
        event?.query.queryKey[0] === "suggested-connections-sidebar"
      ) {
        void queryClient.invalidateQueries({ queryKey: ["suggested-users"] });
      }
    });
    return () => unsub();
  }, [queryClient]);

  const suggestedUsers = useMemo(() => suggested || [], [suggested]);

  const { data: followStates } = useFollowStates(
    suggestedUsers.map((u) => u.id)
  );

  const visibleUsers = useMemo(
    () =>
      suggestedUsers
        .filter((u) => !dismissed.has(u.id))
        .filter((u) => !followStates?.[u.id]?.isFollowedByUser)
        .slice(0, 4),
    [suggestedUsers, dismissed, followStates]
  );

  const handleDismiss = useCallback((userId: string) => {
    setDismissed((prev) => new Set([...prev, userId]));
    void (async () => {
      try {
        await kyInstance.post("/api/users/suggested/dismiss", {
          json: { userId },
        });
      } catch {
        // Dismissal is best-effort; local state already removed the user.
      }
    })();
  }, []);

  const handleFollowed = useCallback(
    (userId: string) => {
      // Optimistic removal: hide the followed user immediately, don't wait for refetch
      setDismissed((prev) => new Set([...prev, userId]));
      // Invalidate and refetch in background to replenish
      void queryClient.invalidateQueries({ queryKey: ["suggested-users"] });
      void refetch();
    },
    [queryClient, refetch]
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Clear dismissed and force bypass cache
    setDismissed(new Set());
    try {
      await kyInstance
        .get("/api/users/suggested?limit=6&refresh=1")
        .json<SuggestedUser[]>();
    } catch {
      // Ignore, refetch will handle
    }
    await queryClient.invalidateQueries({ queryKey: ["suggested-users"] });
    await refetch();
    setIsRefreshing(false);
  }, [queryClient, refetch]);

  // Reset dismissed when new data arrives and is substantially different
  useEffect(() => {
    if (suggestedUsers.length === 0) {
      return;
    }
    // If every suggestion is dismissed or followed, show the empty state;
    // the refresh button replenishes.
    const allHandled = suggestedUsers.every(
      (u) => dismissed.has(u.id) || followStates?.[u.id]?.isFollowedByUser
    );
    if (allHandled && visibleUsers.length === 0 && dismissed.size > 0) {
      // All handled: keep the empty state visible until the user refreshes.
    }
  }, [suggestedUsers, visibleUsers, dismissed, followStates]);

  const showEmpty = isLoggedIn && !isLoading && visibleUsers.length === 0;
  const showSkeletons = isLoggedIn && isLoading && suggestedUsers.length === 0;

  return (
    <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <TrendingTopics />

        <SubCard
          action={
            isLoggedIn ? (
              <button
                aria-label="Refresh suggestions"
                className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-50"
                disabled={isFetching || isRefreshing}
                onClick={handleRefresh}
                type="button"
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    (isFetching || isRefreshing) && "animate-spin"
                  )}
                />
              </button>
            ) : undefined
          }
          icon={
            <UserRound className="text-muted-foreground h-4 w-4 shrink-0" />
          }
          title="Who to follow"
        >
          {isLoggedIn ? (
            <WhoToFollowContent
              followStates={followStates}
              handleDismiss={handleDismiss}
              handleFollowed={handleFollowed}
              handleRefresh={handleRefresh}
              isError={isError}
              refetch={refetch}
              showEmpty={showEmpty}
              showSkeletons={showSkeletons}
              suggestedUsers={suggestedUsers}
              visibleUsers={visibleUsers}
            />
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
