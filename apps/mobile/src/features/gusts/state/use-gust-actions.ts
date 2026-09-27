// Per-gust mutations for the reel's rail, ported from web's use-gust-vote,
// BookmarkButton and ClientFollowButton. Every mutation is optimistic,
// generation-guarded (only the latest tap may settle state), rolls back on
// failure with web's destructive toast, and logs its outcome. Guests are
// sent to login instead of firing requests.
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { engagementStore } from "@/features/feed/lib/engagement-store";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import {
  getUserVote,
  isBookmarkedByUser,
} from "@/features/feed/lib/feed-types";
import { usePostEngagement } from "@/features/feed/state/use-post-engagement";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

import {
  GUST_VOTE_ERROR_COPY,
  gustVoteToast,
  planGustVote,
} from "../lib/gust-vote";
import { setFollowing as setFollowOnServer } from "../lib/gusts-api";

async function context() {
  return { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() };
}

// A re-read of one post's viewer state, straight through the shared store.
// The store collapses this to nothing when the feed already seeded the post
// inside the stale window, so calling it on activation is cheap.
async function refreshEngagement(postId: string): Promise<void> {
  try {
    await engagementStore.refresh(postId, await context());
  } catch {
    // Best effort: the payload's snapshot stays on screen.
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function authorName(post: FeedPost): string {
  return post.user?.displayName || post.user?.username || "this creator";
}

export function useGustVote(
  post: FeedPost,
  viewerId: string | null,
  active: boolean
) {
  const router = useRouter();
  // The same store the feed cards use, so amplifying a gust in the reel and
  // the same post in the feed can never disagree. The payload already carries
  // the viewer's vote, so this seeds it rather than fetching it.
  const { engagement, vote } = usePostEngagement({
    aura: post.aura ?? 0,
    postId: post.id,
    userVote: getUserVote(post),
    viewerId,
  });
  const stateRef = useRef(engagement);

  useEffect(() => {
    stateRef.current = engagement;
  }, [engagement]);

  // A genuine re-read, once the gust is actually watched (web's vote-info
  // query), so off-screen cards cost no requests. The store's stale window
  // collapses repeats for a post the feed already seeded.
  useEffect(() => {
    if (!viewerId || !active) {
      return;
    }
    void refreshEngagement(post.id);
    // Runs when a gust becomes the active tile; post.id re-keys on reuse.
  }, [active, post.id, viewerId]);

  const run = async (value: 1 | -1, forced: boolean) => {
    if (!viewerId) {
      router.push("/(auth)/login");
      return;
    }
    const previous = stateRef.current;
    const plan = planGustVote(previous, value, forced);
    if (plan.noop) {
      return;
    }
    try {
      await vote(value);
      logInfo("gusts.voted", { forced, target: plan.target });
      const copy = forced
        ? null
        : gustVoteToast(plan, previous.userVote, authorName(post));
      if (copy) {
        toast(copy);
      }
    } catch (error) {
      logWarn("gusts.vote_failed", { forced, reason: reason(error) });
      toast({
        description: GUST_VOTE_ERROR_COPY,
        title: "Vote Failed",
        variant: "destructive",
      });
    }
  };

  return {
    // Double tap: a forced, silent +1 that never un-amplifies.
    amplify: () => {
      void run(1, true);
    },
    aura: engagement.aura,
    toggleVote: (value: 1 | -1) => {
      void run(value, false);
    },
    userVote: engagement.userVote,
  };
}

export function useGustBookmark(
  post: FeedPost,
  viewerId: string | null,
  active: boolean
) {
  const router = useRouter();
  // Shares the store with the feed card, so bookmarking in the reel shows up
  // in the feed without either side re-reading.
  const { engagement, refresh, toggleBookmark } = usePostEngagement({
    initialBookmarked: isBookmarkedByUser(post, viewerId ?? undefined),
    postId: post.id,
    viewerId,
  });
  const bookmarked = engagement.isBookmarkedByUser;

  useEffect(() => {
    if (!viewerId || !active) {
      return;
    }
    void refresh();
    // Runs when a gust becomes the active tile. `refresh` already closes over
    // post.id, so it re-keys on reuse without listing it again.
  }, [active, refresh, viewerId]);

  const toggle = async () => {
    if (!viewerId) {
      router.push("/(auth)/login");
      return;
    }
    const next = !bookmarked;
    try {
      await toggleBookmark();
      logInfo("gusts.bookmarked", { saved: next });
      toast(
        next
          ? {
              description: "Post saved, find it anytime in your bookmarks",
              title: "Bookmarked",
            }
          : {
              description: "Removed from your bookmarks",
              title: "Bookmark Removed",
            }
      );
    } catch (error) {
      logWarn("gusts.bookmark_failed", { reason: reason(error) });
      toast({
        description: "That didn't go through, give it another try?",
        title: "Bookmark Failed",
        variant: "destructive",
      });
    }
  };

  return { bookmarked, toggle };
}

// Web shows Follow only to signed-in viewers, never on their own gust, and
// only when they do not already follow; after a tap it stays for the
// session so the label can switch (and undo is one tap away).
export function useGustFollow(post: FeedPost, viewerId: string | null) {
  const authorId = post.user?.id ?? null;
  // oxlint-disable-next-line react/hook-use-state -- one-shot initial snapshot; the live value rides the following state below
  const [initiallyFollowing] = useState(() =>
    Boolean(
      viewerId &&
      post.user?.followers?.some((entry) => entry.followerId === viewerId)
    )
  );
  const [following, setFollowing] = useState(initiallyFollowing);
  const [pending, setPending] = useState(false);
  const visible =
    Boolean(viewerId) &&
    authorId !== null &&
    authorId !== viewerId &&
    !initiallyFollowing;

  const toggle = () => {
    if (!authorId || pending) {
      return;
    }
    const next = !following;
    setFollowing(next);
    setPending(true);
    void (async () => {
      try {
        const info = await setFollowOnServer(authorId, next, await context());
        setFollowing(info.isFollowedByUser);
        logInfo("gusts.followed", { follow: next });
      } catch (error) {
        logWarn("gusts.follow_failed", { reason: reason(error) });
        setFollowing(!next);
        toast({
          description: "That didn't go through, give it another try?",
          title: next ? "Follow Failed" : "Unfollow Failed",
          variant: "destructive",
        });
      }
      setPending(false);
    })();
  };

  return { following, pending, toggle, visible };
}
