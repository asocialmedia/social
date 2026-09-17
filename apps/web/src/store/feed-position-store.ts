import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

// Where you were in a feed: the raw scroll offset plus the post sitting at
// the top of the viewport and its distance from it. The anchor is what makes
// restores survive image-height drift - raw pixels alone would misplace you
// once media above the fold finishes loading at a different height.
export interface FeedPosition {
  anchorOffset: number;
  anchorPostId: string | null;
  scrollTop: number;
  updatedAt: number;
}

interface FeedPositionSnapshot {
  positions: Record<string, FeedPosition>;
}

interface FeedPositionState extends FeedPositionSnapshot {
  clearFeedPosition: (key: string) => void;
  resetFeedPositions: () => void;
  saveFeedPosition: (key: string, entry: FeedPosition) => void;
}

// One entry per tracked surface (home tab, explore tab, profile tab, post).
// Bounded so profile-hopping cannot grow sessionStorage without limit; the
// oldest entry is evicted when a new key arrives past capacity.
export const MAX_SAVED_FEED_POSITIONS = 50;

const EMPTY_SNAPSHOT: FeedPositionSnapshot = {
  positions: {},
};

// sessionStorage is the right home for scroll memory: it survives reloads
// (back-to-where-you-were still works after a refresh) and dies with the tab,
// so a fresh visit days later never jumps mid-feed. It is unavailable during
// SSR, where zustand's persist middleware would then skip attaching
// `store.persist` entirely - the in-memory fallback keeps the API defined in
// every environment.
function feedPositionStorage(): StateStorage {
  try {
    // oxlint-disable-next-line unicorn/no-typeof-undefined -- typeof is the only safe probe here: window itself may be undeclared on the server.
    if (typeof window !== "undefined" && window.sessionStorage !== undefined) {
      return window.sessionStorage;
    }
  } catch {
    // Accessing sessionStorage itself can throw (blocked third-party
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

function isValidPosition(entry: unknown): entry is FeedPosition {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const { anchorOffset, anchorPostId, scrollTop, updatedAt } = entry as Record<
    string,
    unknown
  >;
  return (
    typeof anchorOffset === "number" &&
    Number.isFinite(anchorOffset) &&
    (anchorPostId === null || typeof anchorPostId === "string") &&
    typeof scrollTop === "number" &&
    Number.isFinite(scrollTop) &&
    typeof updatedAt === "number" &&
    Number.isFinite(updatedAt)
  );
}

// Persisted payloads are untrusted (hand-editable sessionStorage), so
// rehydration sanitizes instead of spreading blindly.
function sanitizeSnapshot(persisted: unknown): FeedPositionSnapshot {
  if (typeof persisted !== "object" || persisted === null) {
    return { positions: {} };
  }
  const { positions } = persisted as Partial<
    Record<keyof FeedPositionSnapshot, unknown>
  >;
  if (typeof positions !== "object" || positions === null) {
    return { positions: {} };
  }
  const clean: Record<string, FeedPosition> = {};
  for (const [key, entry] of Object.entries(positions)) {
    if (isValidPosition(entry)) {
      clean[key] = {
        anchorOffset: Math.max(0, entry.anchorOffset),
        anchorPostId: entry.anchorPostId,
        scrollTop: Math.max(0, entry.scrollTop),
        updatedAt: entry.updatedAt,
      };
    }
  }
  return { positions: clean };
}

export const useFeedPositionStore = create<FeedPositionState>()(
  persist(
    (set) => ({
      ...EMPTY_SNAPSHOT,
      clearFeedPosition: (key) =>
        set((state) => {
          if (!(key in state.positions)) {
            return state;
          }
          return {
            positions: Object.fromEntries(
              Object.entries(state.positions).filter(([id]) => id !== key)
            ),
          };
        }),
      resetFeedPositions: () => set({ positions: {} }),
      saveFeedPosition: (key, entry) =>
        set((state) => {
          const merged: Record<string, FeedPosition> = {
            ...state.positions,
            [key]: entry,
          };
          const keys = Object.keys(merged);
          if (keys.length <= MAX_SAVED_FEED_POSITIONS) {
            return { positions: merged };
          }
          // Evict the stalest entries first, never the one just saved.
          const overflow = keys.length - MAX_SAVED_FEED_POSITIONS;
          const evict = new Set(
            keys
              .filter((id) => id !== key)
              .map((id) => ({ id, updatedAt: merged[id].updatedAt }))
              .toSorted((a, b) => a.updatedAt - b.updatedAt)
              .slice(0, overflow)
              .map(({ id }) => id)
          );
          return {
            positions: Object.fromEntries(
              Object.entries(merged).filter(([id]) => !evict.has(id))
            ),
          };
        }),
    }),
    {
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeSnapshot(persisted),
      }),
      name: "asm-feed-positions",
      partialize: (state) => ({ positions: state.positions }),
      // Hydration is manual (see useFeedPositionReady) so the server render
      // and the first client paint agree - the saved offset is applied after
      // mount instead of flashing in mid-hydration.
      skipHydration: true,
      storage: createJSONStorage(() => feedPositionStorage()),
      version: 1,
    }
  )
);

// Reactive hydration flag for feed surfaces. Every `persist` access is
// guarded: in environments without any storage the middleware never attaches
// the API, and readers must degrade instead of crashing the render.
export function useFeedPositionReady(): boolean {
  const [ready, setReady] = useState(
    () => useFeedPositionStore.persist?.hasHydrated() ?? false
  );

  useEffect(() => {
    const persistApi = useFeedPositionStore.persist;
    if (!persistApi) {
      return;
    }
    if (persistApi.hasHydrated()) {
      // oxlint-disable-next-line react/set-state-in-effect -- adopting the rehydrated positions must happen after mount so SSR/hydration markup stays stable.
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
