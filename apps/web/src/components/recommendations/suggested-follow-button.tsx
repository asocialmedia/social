"use client";

import { Button } from "@asm/ui/shadui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ExternalFollowButton } from "@/components/protocols/external-follow-button";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import {
  useFollowUserMutation,
  useUnfollowUserMutation,
} from "@/hooks/users/user-mutations";
import type {
  RecommendedAccount,
  DiscoverySuggestions,
} from "@/lib/recommendations/suggestion-types";
import { cn } from "@/lib/utils";

export function SuggestedFollowButton({
  account,
  className,
  onAuthRedirect,
}: {
  account: RecommendedAccount;
  className?: string;
  onAuthRedirect?: () => void;
}) {
  const auth = useRequireAuth();
  const client = useQueryClient();
  const followed = () => {
    client.setQueriesData<DiscoverySuggestions>(
      { queryKey: ["discovery-suggestions", auth.user?.id ?? "guest"] },
      (current) =>
        current
          ? {
              ...current,
              accounts: current.accounts.filter(
                (candidate) =>
                  candidate.source !== account.source ||
                  candidate.id !== account.id
              ),
            }
          : current
    );
    void client.invalidateQueries({
      queryKey: ["discovery-suggestions", auth.user?.id ?? "guest"],
    });
  };
  const buttonClass = cn("h-7 w-full rounded-full! px-3 text-xs!", className);
  if (!auth.isLoggedIn) {
    return (
      <Button
        className={buttonClass}
        variant="premium"
        onClick={() => {
          onAuthRedirect?.();
          auth.goToLogin();
        }}
      >
        Follow
      </Button>
    );
  }
  if (account.source === "bluesky") {
    return (
      <ExternalFollowButton
        did={account.id}
        initialFollowing={account.following}
        className={buttonClass}
        onFollowed={followed}
      />
    );
  }
  if (account.id === auth.user?.id) {
    return null;
  }
  return (
    <NativeSuggestedFollow
      account={account}
      className={buttonClass}
      onFollowed={followed}
      viewer={auth.user?.id ?? "guest"}
    />
  );
}

function NativeSuggestedFollow({
  account,
  className,
  onFollowed,
  viewer,
}: {
  account: RecommendedAccount;
  className: string;
  onFollowed: () => void;
  viewer: string;
}) {
  const client = useQueryClient();
  const key = ["recommendation-follow", viewer, account.id];
  const state = useQuery({
    enabled: false,
    initialData: { following: account.following },
    queryFn: () => ({ following: account.following }),
    queryKey: key,
  });
  const follow = useFollowUserMutation();
  const unfollow = useUnfollowUserMutation();
  const pending = follow.isPending || unfollow.isPending;
  let label = state.data.following ? "Following" : "Follow";
  if (pending) {
    label = "Updating…";
  }
  return (
    <Button
      variant="premium"
      className={className}
      disabled={pending}
      onClick={() => {
        const mutation = state.data.following ? unfollow : follow;
        mutation.mutate(account.id, {
          onSuccess: (next) => {
            client.setQueryData(key, { following: next.isFollowedByUser });
            if (next.isFollowedByUser) {
              onFollowed();
            }
          },
        });
      }}
    >
      {label}
    </Button>
  );
}
