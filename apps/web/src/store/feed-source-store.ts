import type { FeedSource } from "@asm/protocols/discovery";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const EMPTY = new Set<string>();

export const useFeedSourceStore = create<{
  excluded: Record<string, ReadonlySet<string>>;
  exclude: (viewer: string, key: string, hidden: boolean) => void;
  source: FeedSource;
  setSource: (source: FeedSource) => void;
  language: "auto" | "en" | "all";
  setLanguage: (language: "auto" | "en" | "all") => void;
}>()(
  persist(
    (set) => ({
      exclude: (viewer, key, hidden) =>
        set((state) => {
          const next = new Set(state.excluded[viewer] ?? EMPTY);
          if (hidden) {
            next.add(key);
          } else {
            next.delete(key);
          }
          return { excluded: { ...state.excluded, [viewer]: next } };
        }),
      excluded: {},
      language: "auto",
      setLanguage: (language) => set({ language }),
      setSource: (source) => set({ source }),
      source: "all",
    }),
    {
      name: "asm-feed-preferences",
      partialize: (state) => ({
        language: state.language,
        source: state.source,
      }),
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export function useExternalExclusions(viewer: string) {
  return useFeedSourceStore((state) => state.excluded[viewer] ?? EMPTY);
}
