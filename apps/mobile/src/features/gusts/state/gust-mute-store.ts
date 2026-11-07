// Static expo imports break bun tests (react-native flow types), so storage
// is injected: the app passes a SecureStore adapter below, tests pass a
// memory double. The adapter loads SecureStore lazily for the same reason
// the composer store keeps its SecureStore import inside a function.
import { create } from "zustand";

const STORAGE_KEY = "gust-video-muted";

export interface GustMuteStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
}

interface GustMuteState {
  hydrate: () => Promise<void>;
  hydrated: boolean;
  isMuted: boolean;
  toggleMuted: () => void;
}

export interface GustMuteReporter {
  restoreFailed: (reason: string) => void;
}

// Static telemetry pulls expo-constants (and react-native) into the module
// graph, which bun cannot load; the default reporter therefore imports it
// lazily, and tests inject a spy instead.
function defaultReporter(): GustMuteReporter {
  return {
    restoreFailed: (reason) => {
      void (async () => {
        try {
          const telemetry = await import("@/lib/lifecycle/telemetry");
          telemetry.logWarn("gusts.mute_restore_failed", { reason });
        } catch {
          // Telemetry must never break playback state.
        }
      })();
    },
  };
}

// Injectable for tests: bun cannot load expo-secure-store, and an in-memory
// double makes the write-ordering race deterministic.
export function createGustMuteStore(
  storage: GustMuteStorage,
  reporter: GustMuteReporter = defaultReporter()
) {
  // Writes serialize through this chain: rapid toggles used to fire
  // concurrent setItemAsync calls and the last to *complete* won, persisting
  // the inverse of the in-memory flag. Chaining keeps completion order equal
  // to tap order; a failed write never breaks the chain.
  let persistChain: Promise<void> = Promise.resolve();
  return create<GustMuteState>((set, get) => ({
    hydrate: async () => {
      if (get().hydrated) {
        return;
      }
      try {
        const stored = await storage.getItem(STORAGE_KEY);
        set({
          hydrated: true,
          isMuted: stored === null ? get().isMuted : stored === "true",
        });
      } catch (error) {
        set({ hydrated: true });
        reporter.restoreFailed(
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    hydrated: false,
    isMuted: true,
    toggleMuted: () => {
      const isMuted = !get().isMuted;
      set({ isMuted });
      const previous = persistChain;
      persistChain = (async () => {
        try {
          await previous;
        } catch {
          // A previous write's failure is already swallowed below; the chain
          // itself must stay alive for the next toggle.
        }
        try {
          await storage.setItem(STORAGE_KEY, String(isMuted));
        } catch {
          // Persisting is best-effort; the in-memory flag already flipped.
        }
      })();
    },
  }));
}

let secureStoreModule: Promise<GustMuteStorage> | null = null;
function secureStore(): Promise<GustMuteStorage> {
  secureStoreModule ??= (async () => {
    const SecureStore = await import("expo-secure-store");
    return {
      getItem: (key: string) => SecureStore.getItemAsync(key),
      setItem: (key: string, value: string) =>
        SecureStore.setItemAsync(key, value),
    };
  })();
  return secureStoreModule;
}

export const useGustMuteStore = createGustMuteStore({
  getItem: async (key) => {
    const store = await secureStore();
    return store.getItem(key);
  },
  setItem: async (key, value) => {
    const store = await secureStore();
    await store.setItem(key, value);
  },
});

// Early startup task (before the reel mounts): players capture the mute flag
// at creation, so resolving storage under the splash avoids a muted/unmuted
// flash on first paint for users whose stored value differs from the default.
export function hydrateGustMute(): Promise<void> {
  return useGustMuteStore.getState().hydrate();
}
