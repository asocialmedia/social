import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";

import {
  fetchFollowInfo,
  fetchProfileByUsername,
  fetchProfileFeedPage,
  mutateFollow,
} from "./profile-api";
import type { ProfileFeedPage } from "./profile-api";
import {
  BoundedProfileCache,
  PROFILE_FEED_STALE_MS,
  PROFILE_STALE_MS,
} from "./profile-cache";
import type { ProfileViewTab } from "./profile-tab-memory";
import type {
  ProfileFeedView,
  ProfileHeaderProfile,
} from "./profile-view-model";
import { SingleFlight } from "./single-flight";

export { fetchProfileUserList } from "./profile-api";
export type {
  FollowInfo,
  FollowMutationResult,
  ProfileListKind,
  ProfileUserListItem,
} from "./profile-api";

const PROFILE_CACHE_LIMIT = 20;
const PROFILE_FEED_CACHE_LIMIT = 60;

const profileCache = new BoundedProfileCache<ProfileHeaderProfile>({
  maxEntries: PROFILE_CACHE_LIMIT,
  staleMs: PROFILE_STALE_MS,
});
const profileFeedCache = new BoundedProfileCache<ProfileFeedPage>({
  maxEntries: PROFILE_FEED_CACHE_LIMIT,
  staleMs: PROFILE_FEED_STALE_MS,
});

function cacheKey(viewerId: string, username: string): string {
  return `${viewerId}:${username.trim().toLowerCase()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Couldn't load this profile";
}

// One request per cache key, shared between a press-in prefetch and the screen
// that later mounts for the same profile. Without this the two would race and
// fire duplicate fetches for the same user.
const profileRequests = new SingleFlight();

function loadProfile(key: string, usernameKey: string): Promise<void> {
  return profileRequests.run(key, async () => {
    try {
      const cookie = await authClient.getCookie();
      const options = { apiBase: getApiBaseUrl(), cookie };
      const profile = await fetchProfileByUsername(usernameKey, options);
      const followInfo = await fetchFollowInfo(profile.id, options);
      profileCache.setData(key, {
        ...profile,
        _count: { ...profile._count, followers: followInfo.followers },
        isFollowing: followInfo.isFollowedByUser,
      });
    } catch (error) {
      // A failure after a prefetch still records the error, so a later mount
      // shows the retry state instead of silently fetching forever.
      profileCache.setError(key, errorMessage(error));
    }
  });
}

// Warms the profile cache ahead of navigation. Call from onPressIn so the
// request is already in flight by the time the route mounts, which lets the
// screen paint its real content immediately instead of a full-screen spinner.
// Prefetching is best effort: failures land in the cache as an error state and
// the screen retries normally.
export function usePrefetchProfile(): (
  username: string | null | undefined
) => void {
  const { user: sessionUser } = useSessionContext();
  const viewerKey = sessionUser?.id ?? "guest";
  return useCallback(
    (username: string | null | undefined) => {
      const usernameKey = username?.trim().toLowerCase();
      if (!usernameKey) {
        return;
      }
      const key = cacheKey(viewerKey, usernameKey);
      // A fresh entry needs no request, and an in-flight one is already being
      // awaited, so both cases return without touching the network.
      if (profileCache.isFresh(key) || profileRequests.has(key)) {
        return;
      }
      profileCache.markStale(key);
      void loadProfile(key, usernameKey);
    },
    [viewerKey]
  );
}

function feedKind(tab: ProfileViewTab): ProfileFeedPage["kind"] {
  if (tab === "media") {
    return "media";
  }
  return tab === "eddies" ? "replies" : "posts";
}

function profileStatus(
  resource: ReturnType<BoundedProfileCache<ProfileHeaderProfile>["read"]>
): "error" | "loading" | "success" {
  if (resource.status === "error") {
    return "error";
  }
  return resource.data ? "success" : "loading";
}

function feedStatus(
  isLoadingMore: boolean,
  resource: ReturnType<BoundedProfileCache<ProfileFeedPage>["read"]>
): "error" | "idle" | "loading" | "loading-more" | "success" {
  if (isLoadingMore) {
    return "loading-more";
  }
  if (resource.status === "error") {
    return "error";
  }
  if (resource.status === "idle") {
    return "idle";
  }
  return resource.data ? "success" : "loading";
}

function mergePages(
  current: ProfileFeedPage | null,
  next: ProfileFeedPage
): ProfileFeedPage {
  if (!current || current.kind !== next.kind) {
    return next;
  }
  if (next.kind === "posts" && current.kind === "posts") {
    const existing = new Map(current.items.map((item) => [item.id, item]));
    return {
      items: [
        ...current.items,
        ...next.items.filter((item) => !existing.has(item.id)),
      ],
      kind: "posts",
      nextCursor: next.nextCursor,
    };
  }
  if (current.kind === "media" && next.kind === "media") {
    const existing = new Set(current.items.map((item) => item.id));
    return {
      items: [
        ...current.items,
        ...next.items.filter((item) => !existing.has(item.id)),
      ],
      kind: "media",
      nextCursor: next.nextCursor,
    };
  }
  if (current.kind === "replies" && next.kind === "replies") {
    const existing = new Set(current.items.map((item) => item.id));
    return {
      items: [
        ...current.items,
        ...next.items.filter((item) => !existing.has(item.id)),
      ],
      kind: "replies",
      nextCursor: next.nextCursor,
    };
  }
  return next;
}

export function useProfile(username: string): {
  profile: ProfileHeaderProfile | null;
  status: "error" | "loading" | "success";
  reload: () => void;
  follow: (next: boolean) => Promise<void>;
  isFollowing: boolean;
} {
  const { user: sessionUser } = useSessionContext();
  const viewerKey = sessionUser?.id ?? "guest";
  const usernameKey = username.trim().toLowerCase();
  const key = cacheKey(viewerKey, username);
  const resource = useSyncExternalStore(
    profileCache.subscribe,
    () => profileCache.read(key),
    () => profileCache.read(key)
  );
  const { runWithInstallToken } = useInstall();
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => {
    if (key) {
      profileCache.markStale(key);
      setReloadToken((value) => value + 1);
    }
  }, [key]);

  useEffect(() => {
    void reloadToken;
    if (!key || profileCache.isFresh(key)) {
      return;
    }
    profileCache.markStale(key);
    // Deliberately no "is this still mounted" guard: the cache write is keyed
    // and idempotent, so letting it land after unmount is what makes a
    // press-in prefetch pay off. Skipping an unmounted screen's result is what
    // left the next mount staring at a spinner.
    void loadProfile(key, usernameKey);
    // reloadToken intentionally re-runs the effect after markStale.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [key, reloadToken, usernameKey]);

  const follow = useCallback(
    async (next: boolean) => {
      const current = profileCache.read(key).data;
      if (!current) {
        return;
      }
      const previous: ProfileHeaderProfile = {
        ...current,
        _count: { ...current._count },
        isFollowing: current.isFollowing,
      };
      const optimistic: ProfileHeaderProfile = {
        ...current,
        _count: {
          ...current._count,
          followers: Math.max(0, current._count.followers + (next ? 1 : -1)),
        },
        isFollowing: next,
      };
      profileCache.setData(key, optimistic);
      try {
        const result = await runWithInstallToken(
          async () =>
            mutateFollow(current.id, next, {
              apiBase: getApiBaseUrl(),
              cookie: await authClient.getCookie(),
            }),
          (value) => value.kind === "install-token-required"
        );
        if (!result) {
          profileCache.setData(key, previous);
          return;
        }
        if (result.kind !== "success") {
          profileCache.setData(key, previous);
          return;
        }
        profileCache.setData(key, {
          ...optimistic,
          _count: { ...optimistic._count, followers: result.followers },
          isFollowing: result.isFollowedByUser,
        });
      } catch {
        profileCache.setData(key, previous);
      }
    },
    [key, runWithInstallToken]
  );

  return {
    follow,
    isFollowing: resource.data?.isFollowing ?? false,
    profile: resource.data,
    reload,
    status: profileStatus(resource),
  };
}

export function useProfileFeed({
  enabled,
  tab,
  username,
}: {
  enabled: boolean;
  tab: ProfileViewTab;
  username: string;
}): ProfileFeedView {
  const { user: sessionUser } = useSessionContext();
  const viewerKey = sessionUser?.id ?? "guest";
  const usernameKey = username.trim().toLowerCase();
  const profileKey = cacheKey(viewerKey, usernameKey);
  const tabEnabled =
    enabled && (Boolean(sessionUser) || tab === "posts" || tab === "gusts");
  const profileResource = useSyncExternalStore(
    profileCache.subscribe,
    () => profileCache.read(profileKey),
    () => profileCache.read(profileKey)
  );
  const userId = profileResource.data?.id ?? null;
  const key = `${profileKey}:${tab}`;
  const kind = feedKind(tab);
  const resource = useSyncExternalStore(
    profileFeedCache.subscribe,
    () => profileFeedCache.read(key),
    () => profileFeedCache.read(key)
  );
  const inFlight = useRef<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    void reloadToken;
    if (!tabEnabled || !userId || profileFeedCache.isFresh(key)) {
      return;
    }
    let active = true;
    profileFeedCache.markStale(key);
    void (async () => {
      if (inFlight.current === key) {
        return;
      }
      inFlight.current = key;
      try {
        const cookie = await authClient.getCookie();
        const page = await fetchProfileFeedPage(userId, tab, null, {
          apiBase: getApiBaseUrl(),
          cookie,
        });
        if (active) {
          profileFeedCache.setData(key, page);
        }
      } catch (error) {
        if (active) {
          profileFeedCache.setError(key, errorMessage(error));
        }
      }
      if (inFlight.current === key) {
        inFlight.current = null;
      }
    })();
    return () => {
      active = false;
    };
    // reloadToken intentionally re-runs the effect after markStale.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [key, reloadToken, tab, tabEnabled, userId]);

  const fetchNext = useCallback(() => {
    const current = profileFeedCache.read(key).data;
    if (
      !tabEnabled ||
      !userId ||
      !current?.nextCursor ||
      inFlight.current === key
    ) {
      return;
    }
    const requestKey = `${key}:${current.nextCursor}`;
    if (inFlight.current === requestKey) {
      return;
    }
    inFlight.current = requestKey;
    setIsLoadingMore(true);
    profileFeedCache.patch(key, { status: "success" });
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        const page = await fetchProfileFeedPage(
          userId,
          tab,
          current.nextCursor,
          { apiBase: getApiBaseUrl(), cookie }
        );
        profileFeedCache.setData(key, mergePages(current, page));
      } catch (error) {
        profileFeedCache.setError(key, errorMessage(error));
      }
      setIsLoadingMore(false);
      if (inFlight.current === requestKey) {
        inFlight.current = null;
      }
    })();
  }, [key, tab, tabEnabled, userId]);

  const retry = useCallback(() => {
    if (!tabEnabled || !userId) {
      return;
    }
    profileFeedCache.markStale(key);
    setReloadToken((value) => value + 1);
  }, [key, tabEnabled, userId]);

  const retryFetchNext = resource.status === "error" ? retry : fetchNext;
  const base = {
    error: resource.error,
    hasMore: Boolean(resource.data?.nextCursor),
    reload: retry,
    status: feedStatus(isLoadingMore, resource),
  };

  if (kind === "media") {
    return {
      ...base,
      fetchNext: retryFetchNext,
      kind,
      media: resource.data?.kind === "media" ? resource.data.items : [],
      posts: [],
      tab: "media",
    };
  }
  if (kind === "replies") {
    return {
      ...base,
      fetchNext: retryFetchNext,
      kind,
      posts: [],
      replies: resource.data?.kind === "replies" ? resource.data.items : [],
      tab: "eddies",
    };
  }
  const postTab = tab as Extract<ProfileFeedView, { kind: "posts" }>["tab"];
  return {
    ...base,
    fetchNext: retryFetchNext,
    kind,
    posts: resource.data?.kind === "posts" ? resource.data.items : [],
    tab: postTab,
  };
}
