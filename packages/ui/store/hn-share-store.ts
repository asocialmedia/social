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
    }
  )
);
