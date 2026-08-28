import type { HNStory } from "@asm/aggregator/hackernews";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface HnShareState {
  cancelSharing: () => void;
  clearState: () => void;
  isSharing: boolean;
  setStory: (story: HNStory | null) => void;
  startSharing: (story: HNStory) => void;
  story: HNStory | null;
}

export const useHnShareStore = create<HnShareState>()(
  persist(
    (set) => ({
      cancelSharing: () => set({ isSharing: false }),
      clearState: () => set({ isSharing: false, story: null }),
      isSharing: false,
      setStory: (story) => set({ story }),
      startSharing: (story) => set({ isSharing: true, story }),
      story: null,
    }),
    {
      name: "hn-share-storage",
      // Persisted state must not hydrate synchronously: a stored isSharing
      // would desync SSR'd markup (which always renders the resting store)
      // from the client's first render - a hydration mismatch on every
      // consumer. Consumers call rehydrate() in an effect after mount.
      skipHydration: true,
    }
  )
);
