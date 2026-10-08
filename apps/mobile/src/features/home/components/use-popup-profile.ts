// Share profile metadata across consumers and cold starts before revalidation.
import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";

import {
  hydratePopupCache,
  popupCache,
  popupProfileKey,
} from "./profile-cache";
import type { PopupProfile } from "./profile-data";
import { fetchBookmarkTotal, fetchPopupProfile } from "./profile-data";

export type PopupDataState =
  | { status: "error"; message: string }
  | { status: "loading" }
  | { bookmarkTotal: number | null; profile: PopupProfile; status: "ready" };

const LOADING: PopupDataState = { status: "loading" };
const LOAD_MESSAGE = "Couldn't load this profile. Try again.";

function cachedState(key: string | null): PopupDataState {
  const profile = key ? popupCache.getStaleProfile(key) : null;
  return profile && key
    ? {
        bookmarkTotal: popupCache.getStaleBookmarkTotal(key),
        profile,
        status: "ready",
      }
    : LOADING;
}

export function usePopupProfile(userId: string | null): {
  hydrated: boolean;
  reload: () => void;
  state: PopupDataState;
} {
  const apiBase = getApiBaseUrl();
  const cacheKey = userId ? popupProfileKey(apiBase, userId) : null;
  const [result, setResult] = useState(() => ({
    key: cacheKey,
    state: cachedState(cacheKey),
  }));
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => {
    if (cacheKey) {
      popupCache.invalidate(cacheKey);
      setReloadToken((token) => token + 1);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!userId || !cacheKey) {
      return;
    }
    void reloadToken;
    let cancelled = false;
    void (async () => {
      await hydratePopupCache();
      if (cancelled) {
        return;
      }
      const cached = cachedState(cacheKey);
      setResult({ key: cacheKey, state: cached });
      setHydratedKey(cacheKey);
      if (
        popupCache.getFreshProfile(cacheKey) &&
        popupCache.getFreshBookmarkTotal(cacheKey) !== null
      ) {
        return;
      }
      try {
        const cookie = await authClient.getCookie();
        const [profile, bookmarkTotal] = await Promise.all([
          popupCache.loadProfile(cacheKey, () =>
            fetchPopupProfile({ apiBase, cookie, userId })
          ),
          popupCache
            .loadBookmarkTotal(cacheKey, () =>
              fetchBookmarkTotal({ apiBase, cookie })
            )
            .catch(() => null),
        ]);
        if (!cancelled) {
          setResult({
            key: cacheKey,
            state: { bookmarkTotal, profile, status: "ready" },
          });
        }
      } catch (error) {
        if (!cancelled && cached.status !== "ready") {
          logWarn("profile.popup_failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
          setResult({
            key: cacheKey,
            state: { message: LOAD_MESSAGE, status: "error" },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- reloadToken explicitly repeats the invalidated lookup
  }, [apiBase, cacheKey, userId, reloadToken]);

  return {
    hydrated: !cacheKey || hydratedKey === cacheKey,
    reload,
    state: result.key === cacheKey ? result.state : cachedState(cacheKey),
  };
}
