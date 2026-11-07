// Shared video captions preference, ported from web's video-captions-store:
// on by default, toggled from a post's More menu, and applied to every video
// tile at once. Web persists the flag in localStorage and rehydrates it on
// mount (video-captions-hydration); native persists the same flag in
// SecureStore and rehydrates on first read, so a restart keeps the choice.
// Storage is injected (SecureStore in the app, memory in tests) because the
// native module cannot load under bun.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

interface VideoCaptionsState {
  setShowCaptions: (show: boolean) => void;
  showCaptions: boolean;
  toggleCaptions: () => void;
}

export const CAPTIONS_STORE_KEY = "asm-video-captions";

export function createVideoCaptionsStore(storage?: StateStorage) {
  return create<VideoCaptionsState>()(
    persist(
      (set) => ({
        setShowCaptions: (show) => set({ showCaptions: show }),
        showCaptions: true,
        toggleCaptions: () =>
          set((state) => ({ showCaptions: !state.showCaptions })),
      }),
      {
        name: CAPTIONS_STORE_KEY,
        storage: storage ? createJSONStorage(() => storage) : undefined,
      }
    )
  );
}

async function secureCaptionsStorage(): Promise<StateStorage> {
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: async (key) => {
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    },
    removeItem: async (key) => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Unavailable storage must not break the captions toggle.
      }
    },
    setItem: async (key, value) => {
      try {
        await SecureStore.setItemAsync(key, value);
      } catch {
        // A preference that does not fit stays in memory for this session.
      }
    },
  };
}

function memoryCaptionsStorage(): StateStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(items.get(key) ?? null),
    removeItem: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
    setItem: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
  };
}

export const useVideoCaptionsStore = createVideoCaptionsStore(
  memoryCaptionsStorage()
);

let hydration: Promise<void> | undefined;
// Rehydrates the persisted captions preference once, mirroring web's
// VideoCaptionsHydration. Safe to call from any video surface.
export function hydrateVideoCaptions(): Promise<void> {
  hydration ??= (async () => {
    try {
      const storage = await secureCaptionsStorage();
      useVideoCaptionsStore.persist.setOptions({
        storage: createJSONStorage(() => storage),
      });
      await useVideoCaptionsStore.persist.rehydrate();
    } catch {
      // The default (captions on) stands when storage is unavailable.
    }
  })();
  return hydration;
}
