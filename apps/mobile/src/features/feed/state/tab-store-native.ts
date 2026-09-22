import * as SecureStore from "expo-secure-store";
// Native wiring for the tab memory store: SecureStore persistence (the
// payload is a few ids, well under SecureStore's per-item limit) with
// failures swallowed so storage can never break tab state. Imported by
// components; unit tests target the pure factory in tab-store.ts instead
// (SecureStore pulls in react-native, which bun cannot parse).
import { useEffect, useState } from "react";
import type { StateStorage } from "zustand/middleware";

import { createTabMemoryStore } from "./tab-store";

function secureTabStorage(): StateStorage {
  return {
    getItem: async (name: string) => {
      try {
        return await SecureStore.getItemAsync(name);
      } catch {
        return null;
      }
    },
    removeItem: async (name: string) => {
      try {
        await SecureStore.deleteItemAsync(name);
      } catch {
        // Storage failures must never break tab state.
      }
    },
    setItem: async (name: string, value: string) => {
      try {
        await SecureStore.setItemAsync(name, value);
      } catch {
        // Storage failures must never break tab state.
      }
    },
  };
}

export const useTabStore = createTabMemoryStore(secureTabStorage());

// Reactive hydration flag. Hydration is manual (skipHydration in the factory)
// so the first paint agrees on defaults and the remembered tab applies after
// mount instead of flashing in. Degrades to "not ready" where persist is
// missing.
export function useHomeTabMemoryReady(): boolean {
  const [ready, setReady] = useState(
    () => useTabStore.persist?.hasHydrated() ?? false
  );

  useEffect(() => {
    const persistApi = useTabStore.persist;
    if (!persistApi) {
      return;
    }
    if (persistApi.hasHydrated()) {
      // oxlint-disable-next-line react/set-state-in-effect -- adopting the rehydrated tab memory must happen after mount; the stored tab cannot be derived during render
      setReady(true);
      return;
    }
    const unsubHydrate = persistApi.onHydrate(() => setReady(false));
    const unsubFinish = persistApi.onFinishHydration(() => setReady(true));
    void persistApi.rehydrate();
    // oxlint-disable-next-line react/set-state-in-effect -- sync the flag for storages that rehydrate synchronously
    setReady(persistApi.hasHydrated());
    return () => {
      unsubHydrate();
      unsubFinish();
    };
  }, []);

  return ready;
}
