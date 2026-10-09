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

let hydration: Promise<void> | undefined;
let hydrationSettled = false;
export function hydrateHomeTabMemory(): Promise<void> {
  hydration ??= (async () => {
    try {
      await useTabStore.persist?.rehydrate();
    } catch {
      // Corrupt or unavailable storage falls back to the default tab.
    }
    hydrationSettled = true;
  })();
  return hydration;
}

// Subscribers share the same launch read, including the startup coordinator.
export function useHomeTabMemoryReady(): boolean {
  const [ready, setReady] = useState(
    () => hydrationSettled || (useTabStore.persist?.hasHydrated() ?? false)
  );
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = useTabStore.persist?.onFinishHydration(() =>
      setReady(true)
    );
    void (async () => {
      await hydrateHomeTabMemory();
      if (!cancelled) {
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return ready;
}
