// A per-card playback position that lives outside React state. expo-video
// reports timeUpdate four times a second; writing that into the gust card's
// state re-rendered the whole card (rail, caption, meta, overlays) each time.
// The card now writes here, and only the few small children that show the
// position (seek bar, live caption, transcript highlight) subscribe.

export interface PlaybackClock {
  get: () => number;
  set: (seconds: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPlaybackClock(initial = 0): PlaybackClock {
  let seconds = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => seconds,
    set: (next) => {
      const value = Number.isFinite(next) && next > 0 ? next : 0;
      if (value === seconds) {
        return;
      }
      seconds = value;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
