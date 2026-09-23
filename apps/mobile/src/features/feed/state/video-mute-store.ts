// Shared video mute preference, ported from web's video-mute-store: feed
// clips start muted, and unmuting one carries to every other video instead
// of each tile keeping its own flag. In memory for the session, like web.
import { create } from "zustand";

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
