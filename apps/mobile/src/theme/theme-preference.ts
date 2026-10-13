import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";

export function resolveThemePreference(
  preference: unknown,
  system: "light" | "dark" | "unspecified" | null | undefined
): "light" | "dark" {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return system === "dark" ? "dark" : "light";
}

export function createThemePreferenceStore(storage: StateStorage) {
  return create<{
    preference: ThemePreference;
    setPreference: (value: ThemePreference) => void;
  }>()(
    persist(
      (set) => ({
        preference: "system",
        setPreference: (preference) => set({ preference }),
      }),
      {
        merge: (persisted, current) => {
          const value =
            persisted &&
            typeof persisted === "object" &&
            "preference" in persisted
              ? persisted.preference
              : null;
          return {
            ...current,
            preference:
              value === "light" || value === "dark" ? value : "system",
          };
        },
        name: "asm-theme-preference",
        partialize: ({ preference }) => ({ preference }),
        skipHydration: true,
        storage: createJSONStorage(() => storage),
      }
    )
  );
}
