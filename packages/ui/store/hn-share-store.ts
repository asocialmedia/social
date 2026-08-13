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
      story: null,
      isSharing: false,
      setStory: (story) => set({ story }),
      startSharing: (story) => set({ story, isSharing: true }),
      cancelSharing: () => set({ isSharing: false }),
      clearState: () => set({ story: null, isSharing: false }),
    }),
    {
      name: "hn-share-storage",
    }
  )
);
