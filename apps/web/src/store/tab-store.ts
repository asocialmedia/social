import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

export type HomeTab = "following" | "latest" | "personalized" | "trending";
export type ExploreTab = "for-you" | "people" | "gusts" | "trending";
export type ProfileTab =
  | "posts"
  | "gusts"
  | "responses"
  | "replies"
  | "amplified"
  | "media";

// Remembered tabs expire after 7 days of being set. Anything older is treated
// as if the user never picked it, so stale memory can never strand them on an
// unexpected tab.
export const TAB_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// localStorage is unavailable during SSR (and throws in some embedded /
// locked-down contexts). zustand's persist middleware then skips attaching
// `store.persist` entirely, so any render-path read of it crashes the server
// render. A synchronous in-memory fallback keeps `store.persist` defined in
// every environment; the real localStorage is used wherever it exists.
function tabStorage(): StateStorage {
  try {
    // oxlint-disable-next-line unicorn/no-typeof-undefined -- typeof is the only safe probe here: window itself may be undeclared on the server.
    if (typeof window !== "undefined" && window.localStorage !== undefined) {
      return window.localStorage;
    }
  } catch {
    // Accessing localStorage itself can throw (e.g. blocked third-party
    // storage) - fall through to the in-memory shim below.
  }
  const fallback = new Map<string, string>();
  return {
    getItem: (name) => fallback.get(name) ?? null,
    removeItem: (name) => {
      fallback.delete(name);
    },
    setItem: (name, value) => {
      fallback.set(name, value);
    },
  };
}

export const HOME_TABS: ReadonlySet<HomeTab> = new Set([
  "following",
  "latest",
  "personalized",
  "trending",
]);
export const EXPLORE_TABS: ReadonlySet<ExploreTab> = new Set([
  "for-you",
  "people",
  "gusts",
  "trending",
]);
export const PROFILE_TABS: ReadonlySet<ProfileTab> = new Set([
  "posts",
  "gusts",
  "responses",
  "replies",
  "amplified",
  "media",
]);

// Tabs behind auth. Guests who land on one (e.g. a remembered tab from a
// logged-in session) fall back to the surface default instead of bouncing.
const EXPLORE_GUEST_TABS: ReadonlySet<ExploreTab> = new Set([
  "trending",
  "gusts",
]);
const PROFILE_GUEST_TABS: ReadonlySet<ProfileTab> = new Set([
  "posts",
  "gusts",
  "media",
]);

// Shared membership guard so tab surfaces validate raw strings (URL params,
// stored payloads) without each keeping its own list logic.
export function isTabValue<T extends string>(
  allowed: ReadonlySet<T>,
  value: unknown
): value is T {
  return typeof value === "string" && allowed.has(value as T);
}

export interface TimestampedTab<T> {
  updatedAt: number;
  value: T;
}

interface TabMemorySnapshot {
  explore: TimestampedTab<ExploreTab> | null;
  home: TimestampedTab<HomeTab> | null;
  profileByUserId: Record<string, TimestampedTab<ProfileTab>>;
}

interface TabMemoryState extends TabMemorySnapshot {
  clearProfileTab: (userId: string) => void;
  pruneExpired: () => void;
  resetTabMemory: () => void;
  setExploreTab: (tab: ExploreTab) => void;
  setHomeTab: (tab: HomeTab) => void;
  setProfileTab: (userId: string, tab: ProfileTab) => void;
}

const EMPTY_SNAPSHOT: TabMemorySnapshot = {
  explore: null,
  home: null,
  profileByUserId: {},
};

function isFresh(updatedAt: number, now: number): boolean {
  return (
    Number.isFinite(updatedAt) &&
    updatedAt <= now &&
    now - updatedAt <= TAB_MEMORY_TTL_MS
  );
}

function asFreshTab<T extends string>(
  entry: unknown,
  allowed: ReadonlySet<T>,
  now: number
): TimestampedTab<T> | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const { updatedAt, value } = entry as {
    updatedAt?: unknown;
    value?: unknown;
  };
  if (typeof updatedAt !== "number" || !isTabValue(allowed, value)) {
    return null;
  }
  if (!isFresh(updatedAt, now)) {
    return null;
  }
  return { updatedAt, value };
}

// Persisted payloads are untrusted (hand-editable localStorage, older schema
// versions), so rehydration sanitizes instead of spreading blindly.
function sanitizeSnapshot(persisted: unknown, now: number): TabMemorySnapshot {
  if (typeof persisted !== "object" || persisted === null) {
    return { ...EMPTY_SNAPSHOT, profileByUserId: {} };
  }
  const { explore, home, profileByUserId } = persisted as Partial<
    Record<keyof TabMemorySnapshot, unknown>
  >;
  const cleanProfiles: Record<string, TimestampedTab<ProfileTab>> = {};
  if (typeof profileByUserId === "object" && profileByUserId !== null) {
    for (const [userId, entry] of Object.entries(profileByUserId)) {
      const clean = asFreshTab(entry, PROFILE_TABS, now);
      if (clean) {
        cleanProfiles[userId] = clean;
      }
    }
  }
  return {
    explore: asFreshTab(explore, EXPLORE_TABS, now),
    home: asFreshTab(home, HOME_TABS, now),
    profileByUserId: cleanProfiles,
  };
}

export const useTabStore = create<TabMemoryState>()(
  persist(
    (set) => ({
      ...EMPTY_SNAPSHOT,
      clearProfileTab: (userId) =>
        set((state) => {
          if (!(userId in state.profileByUserId)) {
            return state;
          }
          return {
            profileByUserId: Object.fromEntries(
              Object.entries(state.profileByUserId).filter(
                ([id]) => id !== userId
              )
            ),
          };
        }),
      pruneExpired: () =>
        set((state) => {
          const now = Date.now();
          const home =
            state.home && isFresh(state.home.updatedAt, now)
              ? state.home
              : null;
          const explore =
            state.explore && isFresh(state.explore.updatedAt, now)
              ? state.explore
              : null;
          let profilesChanged = false;
          const profileByUserId: Record<
            string,
            TimestampedTab<ProfileTab>
          > = {};
          for (const [userId, entry] of Object.entries(state.profileByUserId)) {
            if (
              PROFILE_TABS.has(entry.value) &&
              isFresh(entry.updatedAt, now)
            ) {
              profileByUserId[userId] = entry;
            } else {
              profilesChanged = true;
            }
          }
          if (
            home === state.home &&
            explore === state.explore &&
            !profilesChanged
          ) {
            return state;
          }
          return { explore, home, profileByUserId };
        }),
      resetTabMemory: () => set({ ...EMPTY_SNAPSHOT, profileByUserId: {} }),
      setExploreTab: (tab) =>
        set({ explore: { updatedAt: Date.now(), value: tab } }),
      setHomeTab: (tab) => set({ home: { updatedAt: Date.now(), value: tab } }),
      setProfileTab: (userId, tab) =>
        set((state) => ({
          profileByUserId: {
            ...state.profileByUserId,
            [userId]: { updatedAt: Date.now(), value: tab },
          },
        })),
    }),
    {
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeSnapshot(persisted, Date.now()),
      }),
      name: "asm-tab-memory",
      onRehydrateStorage: () => (state) => {
        // Drop anything that expired while the tab was closed before any
        // component reads it.
        state?.pruneExpired();
      },
      partialize: (state) => ({
        explore: state.explore,
        home: state.home,
        profileByUserId: state.profileByUserId,
      }),
      // Hydration is manual (see useTabMemoryReady) so the server render and
      // the first client paint agree on defaults - the remembered tab is
      // applied after mount instead of flashing in mid-hydration.
      skipHydration: true,
      storage: createJSONStorage(() => tabStorage()),
      version: 1,
    }
  )
);

// Reactive hydration flag for client components. Call once per tab surface;
// the store rehydrates on first use and every caller just observes readiness.
// Every `persist` access is guarded: in environments without any storage the
// middleware never attaches the API, and the hook must degrade to "not ready"
// instead of crashing the render.
export function useTabMemoryReady(): boolean {
  const [ready, setReady] = useState(
    () => useTabStore.persist?.hasHydrated() ?? false
  );

  useEffect(() => {
    const persistApi = useTabStore.persist;
    if (!persistApi) {
      return;
    }
    if (persistApi.hasHydrated()) {
      // oxlint-disable-next-line react/set-state-in-effect -- adopting the rehydrated tab memory must happen after mount so SSR/hydration markup stays stable; the stored tab cannot be derived during render.
      setReady(true);
      return;
    }
    const unsubHydrate = persistApi.onHydrate(() => setReady(false));
    const unsubFinish = persistApi.onFinishHydration(() => setReady(true));
    void persistApi.rehydrate();
    // oxlint-disable-next-line react/set-state-in-effect -- same as above: sync the flag for storages that rehydrate synchronously.
    setReady(persistApi.hasHydrated());
    return () => {
      unsubHydrate();
      unsubFinish();
    };
  }, []);

  return ready;
}

function readStored<T extends string>(
  entry: TimestampedTab<T> | null | undefined,
  allowed: ReadonlySet<T>,
  ready: boolean
): T | null {
  if (!ready || !entry) {
    return null;
  }
  if (!allowed.has(entry.value) || !isFresh(entry.updatedAt, Date.now())) {
    return null;
  }
  return entry.value;
}

function parseParam<T extends string>(
  param: string | null,
  allowed: ReadonlySet<T>
): T | null {
  if (!param) {
    return null;
  }
  return isTabValue(allowed, param) ? param : null;
}

// Explicit ?tab= wins (shareable links), then the remembered tab, then the
// surface default. Home shows every tab to guests (Following renders a login
// prompt), so no auth gating here - only the default differs.
export function resolveHomeTab(
  tabParam: string | null,
  isLoggedIn: boolean,
  stored: TimestampedTab<HomeTab> | null | undefined,
  ready: boolean
): HomeTab {
  const fromParam = parseParam(tabParam, HOME_TABS);
  if (fromParam) {
    return fromParam;
  }
  return (
    readStored(stored, HOME_TABS, ready) ??
    (isLoggedIn ? "personalized" : "latest")
  );
}

// Guests only get Trending/Gusts memory; a remembered For you/People from a
// logged-in session falls back to Trending instead of a login wall.
export function resolveExploreTab(
  tabParam: string | null,
  isLoggedIn: boolean,
  stored: TimestampedTab<ExploreTab> | null | undefined,
  ready: boolean
): ExploreTab {
  const fromParam = parseParam(tabParam, EXPLORE_TABS);
  if (fromParam) {
    return fromParam;
  }
  const remembered = readStored(stored, EXPLORE_TABS, ready);
  if (remembered && (isLoggedIn || EXPLORE_GUEST_TABS.has(remembered))) {
    return remembered;
  }
  return isLoggedIn ? "for-you" : "trending";
}

// Profile memory is keyed per user id. Guests fall back to Posts unless the
// remembered tab is one of their open tabs; the xl layout owns Media in a
// sidebar, so a remembered Media tab resolves back to Posts there.
export function resolveProfileTab(
  stored: TimestampedTab<ProfileTab> | null | undefined,
  isLoggedIn: boolean,
  isXl: boolean,
  ready: boolean
): ProfileTab {
  const remembered = readStored(stored, PROFILE_TABS, ready);
  if (!remembered) {
    return "posts";
  }
  if (!isLoggedIn && !PROFILE_GUEST_TABS.has(remembered)) {
    return "posts";
  }
  if (isXl && remembered === "media") {
    return "posts";
  }
  return remembered;
}
