import * as SecureStore from "expo-secure-store";
// The reel's own mute flag, separate from the feed's shared session mute,
// like web's localStorage["gust-video-muted"]. Starts muted, hydrates from
// SecureStore after first paint and writes back on every toggle. Storage
// failures are swallowed: a broken keystore must never block playback.
import { create } from "zustand";

import { logWarn } from "@/lib/telemetry";

const STORAGE_KEY = "gust-video-muted";

interface GustMuteState {
  hydrate: () => Promise<void>;
  hydrated: boolean;
  isMuted: boolean;
  toggleMuted: () => void;
}

export const useGustMuteStore = create<GustMuteState>((set, get) => ({
  hydrate: async () => {
    if (get().hydrated) {
      return;
    }
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      set({
        hydrated: true,
        isMuted: stored === null ? get().isMuted : stored === "true",
      });
    } catch (error) {
      set({ hydrated: true });
      logWarn("gusts.mute_restore_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  },
  hydrated: false,
  isMuted: true,
  toggleMuted: () => {
    const isMuted = !get().isMuted;
    set({ isMuted });
    void (async () => {
      try {
        await SecureStore.setItemAsync(STORAGE_KEY, String(isMuted));
      } catch {
        // Persisting is best-effort; the in-memory flag already flipped.
      }
    })();
  },
}));
