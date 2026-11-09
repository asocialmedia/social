// Optimistic follow for a post's author, ported from web's ClientFollowButton:
// flip immediately, settle on the server's answer, roll back and toast on
// failure, and send guests to login instead of firing a request.
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { mutateFollow } from "@/features/profile/lib/profile-api";
import { logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";

import type { FeedPost } from "../lib/feed-types";
import { resolveFollowing, useFollowStateStore } from "./follow-state-store";

// Web's feed payload filters `user.followers` to the viewer, so a non-empty
// list means the viewer already follows the author.
export function postAuthorFollowSnapshot(
  post: FeedPost,
  viewerId: string | undefined
): boolean {
  const followers = post.user?.followers;
  if (!followers || followers.length === 0) {
    return false;
  }
  return viewerId
    ? followers.some((entry) => entry.followerId === viewerId)
    : false;
}

type RunWithInstallToken = ReturnType<typeof useInstall>["runWithInstallToken"];

// Flips the shared entry first, then settles it on the server's answer. Any
// failure restores the previous state and tells the viewer.
async function sendFollow(
  authorId: string,
  next: boolean,
  runWithInstallToken: RunWithInstallToken
): Promise<void> {
  const store = useFollowStateStore.getState();
  store.setPending(authorId, true);
  store.setFollowing(authorId, next);
  const failTitle = next ? "Follow Failed" : "Unfollow Failed";
  let settled: boolean | null = null;
  let failed = false;
  try {
    const result = await runWithInstallToken(
      async () =>
        mutateFollow(authorId, next, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        }),
      (value) => value.kind === "install-token-required"
    );
    if (result?.kind === "success") {
      settled = result.isFollowedByUser;
    } else {
      // A null result means the install check was dismissed and nothing was
      // sent, which rolls back quietly.
      failed = result !== null;
    }
  } catch (error) {
    logWarn("feed.follow_failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    failed = true;
  }
  const after = useFollowStateStore.getState();
  after.setFollowing(authorId, settled ?? !next);
  after.setPending(authorId, false);
  if (failed) {
    toast({
      description: "That didn't go through, give it another try?",
      title: failTitle,
      variant: "destructive",
    });
  }
}

export function useAuthorFollow(post: FeedPost, viewerId: string | undefined) {
  const router = useRouter();
  const { runWithInstallToken } = useInstall();
  const authorId = post.user?.id ?? null;
  const entry = useFollowStateStore((state) =>
    authorId ? state.entries[authorId] : undefined
  );
  const pending = useFollowStateStore((state) =>
    authorId ? Boolean(state.pending[authorId]) : false
  );
  const following = resolveFollowing(
    entry,
    postAuthorFollowSnapshot(post, viewerId)
  );

  const toggle = useCallback(async () => {
    if (!authorId) {
      return;
    }
    if (!viewerId) {
      router.push("/(auth)/login");
      return;
    }
    const store = useFollowStateStore.getState();
    if (store.pending[authorId]) {
      return;
    }
    await sendFollow(authorId, !following, runWithInstallToken);
  }, [authorId, following, router, runWithInstallToken, viewerId]);

  return { following, pending, toggle };
}
