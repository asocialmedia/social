// Tab memory store, ported from web (store/tab-store.ts). Remembers the home
// tab across sessions (7-day TTL, sanitized on load) with guests defaulting
// to Latest. Pure: no React Native or Expo imports, so the factory, resolvers
// and (via injection) behavior are unit-testable on Node. The SecureStore
// wiring lives in tab-store-native.ts (SecureStore pulls in react-native,
// which bun cannot parse in tests).

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

export type HomeTab = "following" | "latest" | "personalized" | "trending";
export type ExploreTab = "for-you" | "gusts" | "people" | "trending";
export type ProfileTab =
  | "amplified"
  | "gusts"
  | "media"
  | "posts"
  | "replies"
  | "responses";

// Remembered tabs expire after 7 days of being set, like web.
export const TAB_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const HOME_TABS: ReadonlySet<HomeTab> = new Set([
  "following",
  "latest",
  "personalized",
  "trending",
]);

export const EXPLORE_TABS: ReadonlySet<ExploreTab> = new Set([
  "for-you",
  "gusts",
  "people",
  "trending",
]);

export const PROFILE_TABS: ReadonlySet<ProfileTab> = new Set([
  "amplified",
  "gusts",
  "media",
  "posts",
  "replies",
  "responses",
]);

const EXPLORE_GUEST_TABS: ReadonlySet<ExploreTab> = new Set([
  "gusts",
  "trending",
]);

const PROFILE_GUEST_TABS: ReadonlySet<ProfileTab> = new Set([
  "gusts",
  "media",
  "posts",
]);

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

// Persisted payloads are untrusted (older schema versions, tampered
// storage), so rehydration sanitizes instead of spreading blindly.
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

// In-memory storage fallback, mirroring web's tabStorage shim for
// environments without usable storage.
export function memoryTabStorage(): StateStorage {
  const backing = new Map<string, string>();
  return {
    getItem: (name: string) => backing.get(name) ?? null,
    removeItem: (name: string) => {
      backing.delete(name);
    },
    setItem: (name: string, value: string) => {
      backing.set(name, value);
    },
  };
}

export function createTabMemoryStore(
  storage: StateStorage = memoryTabStorage()
) {
  return create<TabMemoryState>()(
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
            for (const [userId, entry] of Object.entries(
              state.profileByUserId
            )) {
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
        setHomeTab: (tab) =>
          set({ home: { updatedAt: Date.now(), value: tab } }),
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
          state?.pruneExpired();
        },
        partialize: (state) => ({
          explore: state.explore,
          home: state.home,
          profileByUserId: state.profileByUserId,
        }),
        skipHydration: true,
        storage: createJSONStorage(() => storage),
        version: 1,
      }
    )
  );
}

export type TabMemoryStore = ReturnType<typeof createTabMemoryStore>;

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

// Explicit tab wins (deep links), then the remembered tab, then the surface
// default. Account-only tabs (For you, Following) are NOT filtered here: the
// tab must stay tappable so its screen can show the sign-in prompt, matching
// how Following has always behaved. Only the guest default differs.
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

export function resolveProfileTab(
  stored: TimestampedTab<ProfileTab> | null | undefined,
  isLoggedIn: boolean,
  ready: boolean
): ProfileTab {
  const remembered = readStored(stored, PROFILE_TABS, ready);
  if (!remembered) {
    return "posts";
  }
  if (!isLoggedIn && !PROFILE_GUEST_TABS.has(remembered)) {
    return "posts";
  }
  return remembered;
}
