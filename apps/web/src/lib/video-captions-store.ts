import { create } from "zustand";
import { persist } from "zustand/middleware";

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
      name: "asocialmedia-video-captions",
    }
  )
);
