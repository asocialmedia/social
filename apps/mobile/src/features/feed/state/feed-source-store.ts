import type { FeedSource } from "@asm/protocols/discovery";
import * as SecureStore from "expo-secure-store";
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
  setSource: (source) => {
    set({ source });
    void persistFeedSource(source);
  },
  source: "all",
}));

export function useExternalExclusions(viewer: string) {
  return useFeedSourceStore((state) => state.excluded[viewer] ?? EMPTY);
}

let hydrated = false;
export async function hydrateFeedSource() {
  if (hydrated) {
    return;
  }
  hydrated = true;
  try {
    const source = await SecureStore.getItemAsync("feed-source-v1");
    if (source === "all" || source === "asm" || source === "bluesky") {
      useFeedSourceStore.setState({ source });
    }
  } catch {
    // Missing secure storage keeps the default source.
  }
}

async function persistFeedSource(source: FeedSource) {
  try {
    await SecureStore.setItemAsync("feed-source-v1", source);
  } catch {
    // Source selection remains available in memory.
  }
}
