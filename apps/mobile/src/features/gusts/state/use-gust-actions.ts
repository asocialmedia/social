// Per-gust mutations for the reel's rail, ported from web's use-gust-vote,
// BookmarkButton and ClientFollowButton. Every mutation is optimistic,
// generation-guarded (only the latest tap may settle state), rolls back on
// failure with web's destructive toast, and logs its outcome. Guests are
// sent to login instead of firing requests.
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  fetchBookmarkInfo,
  fetchVoteInfo,
  submitBookmark,
  submitVote,
} from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import {
  getUserVote,
  isBookmarkedByUser,
} from "@/features/feed/lib/feed-types";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

import {
  GUST_VOTE_ERROR_COPY,
  gustVoteToast,
  planGustVote,
} from "../lib/gust-vote";
import type { GustVoteState } from "../lib/gust-vote";
import { setFollowing as setFollowOnServer } from "../lib/gusts-api";

async function context() {
  return { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() };
}

// Reconciliation reads are best-effort: a network failure keeps the
// payload's snapshot.
async function readSafely<T>(task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch {
    return null;
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
  const [state, setState] = useState<GustVoteState>(() => ({
    aura: post.aura ?? 0,
    userVote: getUserVote(post),
  }));
  const stateRef = useRef(state);
  const generationRef = useRef(0);
  const reconciledRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Reconcile with the server once the gust is actually watched (web's
  // vote-info query), so off-screen cards cost no requests.
  useEffect(() => {
    if (!viewerId || !active || reconciledRef.current) {
      return;
    }
    reconciledRef.current = true;
    let cancelled = false;
    void (async () => {
      const info = await readSafely(async () =>
        fetchVoteInfo(post.id, await context())
      );
      if (!cancelled && info && generationRef.current === 0) {
        setState(info);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, post.id, viewerId]);

  const run = (value: 1 | -1, forced: boolean) => {
    if (!viewerId) {
      router.push("/(auth)/login");
      return;
    }
    const previous = stateRef.current;
    const plan = planGustVote(previous, value, forced);
    if (plan.noop) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    stateRef.current = plan.next;
    setState(plan.next);
    void (async () => {
      try {
        const info = await submitVote(
          post.id,
          plan.target,
          plan.toggleOff,
          await context()
        );
        logInfo("gusts.voted", { forced, target: plan.target });
        if (generationRef.current !== generation) {
          return;
        }
        stateRef.current = info;
        setState(info);
        const copy = forced
          ? null
          : gustVoteToast(plan, previous.userVote, authorName(post));
        if (copy) {
          toast(copy);
        }
      } catch (error) {
        logWarn("gusts.vote_failed", { forced, reason: reason(error) });
        if (generationRef.current !== generation) {
          return;
        }
        stateRef.current = previous;
        setState(previous);
        toast({
          description: GUST_VOTE_ERROR_COPY,
          title: "Vote Failed",
          variant: "destructive",
        });
      }
    })();
  };

  return {
    // Double tap: a forced, silent +1 that never un-amplifies.
    amplify: () => run(1, true),
    aura: state.aura,
    toggleVote: (value: 1 | -1) => run(value, false),
    userVote: state.userVote,
  };
}

export function useGustBookmark(
  post: FeedPost,
  viewerId: string | null,
  active: boolean
) {
  const router = useRouter();
  const [bookmarked, setBookmarked] = useState(() =>
    isBookmarkedByUser(post, viewerId ?? undefined)
  );
  const generationRef = useRef(0);
  const reconciledRef = useRef(false);

  useEffect(() => {
    if (!viewerId || !active || reconciledRef.current) {
      return;
    }
    reconciledRef.current = true;
    let cancelled = false;
    void (async () => {
      const info = await readSafely(async () =>
        fetchBookmarkInfo(post.id, await context())
      );
      if (!cancelled && info !== null && generationRef.current === 0) {
        setBookmarked(info);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, post.id, viewerId]);

  const toggle = () => {
    if (!viewerId) {
      router.push("/(auth)/login");
      return;
    }
    const next = !bookmarked;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setBookmarked(next);
    void (async () => {
      try {
        await submitBookmark(post.id, next, await context());
        logInfo("gusts.bookmarked", { saved: next });
        if (generationRef.current !== generation) {
          return;
        }
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
        if (generationRef.current !== generation) {
          return;
        }
        setBookmarked(!next);
        toast({
          description: "That didn't go through, give it another try?",
          title: "Bookmark Failed",
          variant: "destructive",
        });
      }
    })();
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
