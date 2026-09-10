import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Global video captions preference across all surfaces (feed cards, post pages,
// gusts, and media viewer). Toggling this in the Post More menu updates all video
// cards in the feed simultaneously.
interface VideoCaptionsState {
  setShowCaptions: (show: boolean) => void;
  showCaptions: boolean;
  toggleCaptions: () => void;
}

export const useVideoCaptionsStore = create<VideoCaptionsState>()(
  persist(
    (set) => ({
      setShowCaptions: (show) => set({ showCaptions: show }),
      showCaptions: true,
      toggleCaptions: () =>
        set((state) => ({ showCaptions: !state.showCaptions })),
    }),
    {
      // Hydration is deferred to an explicit rehydrate() call on mount so the
      // persisted value cannot flash the default (true) during SSR/hydration
      // before localStorage is read - a mismatch would re-render every video
      // card on the feed after first paint.
      name: "asocialmedia-video-captions",
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
