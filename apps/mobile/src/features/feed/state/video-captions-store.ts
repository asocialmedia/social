// Shared video captions preference, ported from web's video-captions-store:
// on by default, toggled from a post's More menu, and applied to every video
// tile at once. In memory for the session.
import { create } from "zustand";

interface VideoCaptionsState {
  setShowCaptions: (show: boolean) => void;
  showCaptions: boolean;
  toggleCaptions: () => void;
}

export const useVideoCaptionsStore = create<VideoCaptionsState>((set) => ({
  setShowCaptions: (show) => set({ showCaptions: show }),
  showCaptions: true,
  toggleCaptions: () => set((state) => ({ showCaptions: !state.showCaptions })),
}));
