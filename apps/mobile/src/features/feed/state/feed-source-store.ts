import type { FeedSource } from "@asm/protocols/discovery";
import { create } from "zustand";

const EMPTY = new Set<string>();

export const useFeedSourceStore = create<{
  excluded: Record<string, ReadonlySet<string>>;
  exclude: (viewer: string, key: string, hidden: boolean) => void;
  source: FeedSource;
  setSource: (source: FeedSource) => void;
}>()((set) => ({
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
  setSource: (source) => set({ source }),
  source: "all",
}));

export function useExternalExclusions(viewer: string) {
  return useFeedSourceStore((state) => state.excluded[viewer] ?? EMPTY);
}
