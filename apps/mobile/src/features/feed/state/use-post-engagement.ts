// React binding for the engagement store. One hook backs every surface that
// shows a post's own vote and bookmark, so a feed card, the detail screen, the
// media viewer, the explore grid and a gust card all read and write one value.
//
// The mount-time fetches this replaces are gone: components render whatever the
// payload already resolved, and only an explicit `refresh` (or a mutation
// result) touches the network. That is what took a feed page from ~50 requests
// to zero.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";

import { engagementStore, normalizeEngagement } from "../lib/engagement-store";
import type { PostEngagement } from "../lib/engagement-store";
import { submitBookmark, submitVote } from "../lib/feed-api";
import type { ApiCallOptions } from "../lib/feed-api";

export interface UsePostEngagementOptions {
  /**
   * The post's aura from the payload, used until the store has an answer. Leave
   * undefined when the caller does not own the vote fields (the bookmark
   * toggle), so seeding it cannot reset another component's values.
   */
  aura?: number;
  /**
   * Set when the vote targets a comment eddie rather than the post. Eddie rows
   * carry their vote in props and never re-read it, exactly as before.
   */
  commentId?: string;
  /** Whether the payload says this viewer already bookmarked the post. */
  initialBookmarked?: boolean;
  postId: string;
  /** The viewer's own vote from the payload. */
  userVote?: number;
  /** The signed-in viewer, or null for a guest. Guests hold no server state. */
  viewerId: string | null;
}

export interface PostEngagementActions {
  /** The value to render right now. */
  engagement: PostEngagement;
  /** Applies a confirmed value without a request (already known server-side). */
  publish: (value: Partial<PostEngagement>) => void;
  /** Explicit re-read. Deduplicated and gated by the store's stale window. */
  refresh: () => Promise<void>;
  /** Optimistically toggles the bookmark, rolls back on error. */
  toggleBookmark: () => Promise<void>;
  /** Optimistically casts a vote, reconciles on success, rolls back on error. */
  vote: (value: 1 | -1) => Promise<void>;
}

async function requestContext(): Promise<ApiCallOptions> {
  return { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePostEngagement({
  aura,
  commentId,
  initialBookmarked,
  postId,
  userVote,
  viewerId,
}: UsePostEngagementOptions): PostEngagementActions {
  // Only the fields this caller actually resolved. Undefined fields are left
  // alone by the store, so a bookmark toggle mounting beside a vote cluster
  // cannot reset the vote it never knew about.
  const owned = useMemo<Partial<PostEngagement>>(() => {
    const value: Partial<PostEngagement> = {};
    if (aura !== undefined) {
      value.aura = aura;
    }
    if (userVote !== undefined) {
      value.userVote = userVote;
    }
    if (initialBookmarked !== undefined) {
      value.isBookmarkedByUser = initialBookmarked;
    }
    return value;
  }, [aura, initialBookmarked, userVote]);
  const fallback = useMemo<PostEngagement>(
    () => normalizeEngagement(owned),
    [owned]
  );
  const key = postId;
  // Guests hold no server state, and eddie rows carry their vote in props, so
  // neither subscribes to the store.
  const canPersist = Boolean(viewerId) && !commentId;

  // Eddie rows are reused across comments, so their props change without a
  // remount. This mirrors the prop-sync effect the old VoteCluster carried.
  const [local, setLocal] = useState<PostEngagement | null>(null);
  useEffect(() => {
    if (canPersist) {
      return;
    }
    // oxlint-disable-next-line react/set-state-in-effect -- prop sync for reused comment rows, not derivable during render
    setLocal(fallback);
  }, [canPersist, fallback]);

  const subscribe = useCallback(
    (listener: () => void) =>
      canPersist
        ? engagementStore.subscribe(listener)
        : () => {
            /* empty */
          },
    [canPersist]
  );
  const getSnapshot = useCallback(
    () =>
      canPersist ? engagementStore.read(key, fallback) : (local ?? fallback),
    [canPersist, fallback, key, local]
  );

  const engagement = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Seeds run from an effect, not during render: the store notifies its
  // subscribers, and notifying mid-render would re-enter these components.
  // Re-seeding is deliberate: a fresh feed page for the same post is new
  // server truth, and the merge preserves fields this caller does not own.
  useEffect(() => {
    if (!canPersist) {
      return;
    }
    engagementStore.seed(key, owned);
  }, [canPersist, key, owned]);

  const publish = useCallback(
    (value: Partial<PostEngagement>) => {
      if (canPersist) {
        engagementStore.set(key, { ...getSnapshot(), ...value });
        return;
      }
      setLocal({ ...getSnapshot(), ...value });
    },
    [canPersist, getSnapshot, key]
  );

  const refresh = useCallback(async () => {
    if (!viewerId) {
      return;
    }
    try {
      await engagementStore.refresh(key, await requestContext());
    } catch (error) {
      logWarn("engagement.refresh_failed", {
        postId: key,
        reason: reason(error),
      });
    }
  }, [key, viewerId]);

  // Rapid taps resolve out of order, so only the latest tap's response or
  // rollback may settle state. Same generation guard the old components used.
  const generationRef = useRef(0);

  const vote = useCallback(
    async (value: 1 | -1) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const previous = getSnapshot();
      const toggleOff = previous.userVote === value;
      const target = toggleOff ? 0 : value;
      // Optimistic: +-1 per vote delta, like web calculateVoteChange.
      const optimistic = {
        ...previous,
        aura: previous.aura + (target - previous.userVote),
        userVote: target,
      };
      publish(optimistic);
      try {
        const info = await submitVote(
          postId,
          target,
          toggleOff,
          await requestContext(),
          commentId
        );
        if (generationRef.current !== generation) {
          return;
        }
        publish({ aura: info.aura, userVote: info.userVote });
      } catch (error) {
        if (generationRef.current !== generation) {
          return;
        }
        publish(previous);
        logWarn("engagement.vote_failed", {
          postId: key,
          reason: reason(error),
        });
        throw error;
      }
    },
    [commentId, getSnapshot, key, postId, publish]
  );

  const toggleBookmark = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const previous = getSnapshot();
    const next = !previous.isBookmarkedByUser;
    publish({ ...previous, isBookmarkedByUser: next });
    try {
      await submitBookmark(postId, next, await requestContext());
    } catch (error) {
      if (generationRef.current !== generation) {
        return;
      }
      publish(previous);
      logWarn("engagement.bookmark_failed", {
        postId: key,
        reason: reason(error),
      });
      throw error;
    }
  }, [key, postId, publish, getSnapshot]);

  return { engagement, publish, refresh, toggleBookmark, vote };
}
