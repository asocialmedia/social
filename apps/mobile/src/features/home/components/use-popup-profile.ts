// Data hook for the profile popup. Cache-first with web's 5-minute
// semantics: a fresh entry renders with no network at all; a stale or
// missing entry renders cached data (or a spinner) while a refresh runs;
// a failed refresh keeps stale data instead of erroring, and only a failure
// with nothing cached shows the error state. Bookmark totals refresh on the
// same rules and fail soft (the count chip just hides).

import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";

import { popupCache } from "./profile-cache";
import type { PopupProfile } from "./profile-data";
import { fetchBookmarkTotal, fetchPopupProfile } from "./profile-data";

export type PopupDataState =
  | { status: "error"; message: string }
  | { status: "loading" }
  | {
      bookmarkTotal: number | null;
      profile: PopupProfile;
      status: "ready";
    };

const LOAD_MESSAGE = "Couldn't load this profile. Try again.";

async function refreshProfile(
  userId: string,
  fresh: boolean,
  cookie: string,
  apiBase: string
): Promise<PopupProfile | null> {
  if (fresh) {
    return null;
  }
  const profile = await fetchPopupProfile({
    apiBase,
    cookie,
    userId,
  });
  popupCache.setProfile(userId, profile);
  return profile;
}

async function refreshBookmarks(
  userId: string,
  fresh: boolean,
  cookie: string,
  apiBase: string
): Promise<number | null> {
  if (fresh) {
    return popupCache.getFreshBookmarkTotal(userId);
  }
  const total = await fetchBookmarkTotal({ apiBase, cookie });
  popupCache.setBookmarkTotal(userId, total);
  return total;
}

export function usePopupProfile(userId: string | null): {
  reload: () => void;
  state: PopupDataState;
} {
  const [state, setState] = useState<PopupDataState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    popupCache.invalidate(userId ?? undefined);
    setReloadToken((token) => token + 1);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    // Read so the reload token counts as an effect input: bumping it is the
    // only way to re-run the open sequence after an invalidation.
    void reloadToken;
    let cancelled = false;
    const cached = popupCache.getStaleProfile(userId);
    const cachedBookmarks = popupCache.getStaleBookmarkTotal(userId);
    const profileFresh = popupCache.getFreshProfile(userId) !== null;
    const bookmarksFresh = popupCache.getFreshBookmarkTotal(userId) !== null;

    if (profileFresh && bookmarksFresh) {
      // oxlint-disable-next-line react/set-state-in-effect -- fresh cache renders synchronously; this is the cache-hit path, not derived state
      setState({
        bookmarkTotal: cachedBookmarks,
        profile: cached as PopupProfile,
        status: "ready",
      });
      return;
    }
    if (cached) {
      // oxlint-disable-next-line react/set-state-in-effect -- stale data paints instantly while the refresh runs below
      setState({
        bookmarkTotal: cachedBookmarks,
        profile: cached,
        status: "ready",
      });
    } else {
      // oxlint-disable-next-line react/set-state-in-effect -- nothing cached, the spinner owns the screen until the fetch below settles
      setState({ status: "loading" });
    }

    void (async () => {
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const [profile, bookmarkTotal] = await Promise.all([
          refreshProfile(userId, profileFresh, cookie, apiBase),
          // Bookmark totals fail soft: the count chip just hides.
          refreshBookmarks(userId, bookmarksFresh, cookie, apiBase).catch(
            () => null as number | null
          ),
        ]);
        if (cancelled) {
          return;
        }
        setState({
          bookmarkTotal:
            bookmarkTotal ?? popupCache.getStaleBookmarkTotal(userId),
          profile: profile ?? (cached as PopupProfile),
          status: "ready",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (cached) {
          // Stale beats an error screen: keep showing it and log the miss.
          logWarn("profile.popup_refresh_failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        logWarn("profile.popup_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
        setState({ message: LOAD_MESSAGE, status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadToken re-runs the whole open sequence after an invalidation.
    // It is only void-read above, which the deps rule does not count as a
    // use - but dropping it from the array would silently break reload().
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [userId, reloadToken]);

  return { reload, state };
}
