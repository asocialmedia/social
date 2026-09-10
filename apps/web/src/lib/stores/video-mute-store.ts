import { create } from "zustand";

// Shared video mute preference across surfaces: unmuting a clip in the feed
// carries through to the post page and the fullscreen media viewer (and back),
// instead of every video starting muted wherever it appears. The preference
// lives in memory for the session (feed -> post -> media page navigation is
// client-side, so one store covers all of it).
interface VideoMuteState {
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
}

export const useVideoMuteStore = create<VideoMuteState>((set) => ({
  isMuted: true,
  setMuted: (muted) => set({ isMuted: muted }),
  toggleMuted: () => set((state) => ({ isMuted: !state.isMuted })),
}));
