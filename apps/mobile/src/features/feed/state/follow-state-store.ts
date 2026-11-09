// Shared follow state per author, the native twin of web's useFollowStateStore
// (components/layouts/user/client/follow-state.ts). Every post card by the same
// author reads one entry, so following from one card flips the button on all
// of them, and the profile screen writes here too so the feed agrees with it.
import { create } from "zustand";

// A remembered answer goes stale after five minutes, as on web; after that
// the server's per-post snapshot wins again.
export const FOLLOW_STATE_TTL_MS = 5 * 60 * 1000;

export interface FollowStateEntry {
  following: boolean;
  updatedAt: number;
}

interface FollowStateStore {
  entries: Record<string, FollowStateEntry>;
  pending: Record<string, true>;
  clear: () => void;
  setFollowing: (userId: string, following: boolean, now?: number) => void;
  setPending: (userId: string, pending: boolean) => void;
}

export const useFollowStateStore = create<FollowStateStore>((set) => ({
  clear: () => set({ entries: {}, pending: {} }),
  entries: {},
  pending: {},
  setFollowing: (userId, following, now = Date.now()) =>
    set((state) => ({
      entries: { ...state.entries, [userId]: { following, updatedAt: now } },
    })),
  setPending: (userId, pending) =>
    set((state) => {
      if (pending) {
        return { pending: { ...state.pending, [userId]: true } };
      }
      const { [userId]: _removed, ...rest } = state.pending;
      return { pending: rest };
    }),
}));

// The follow state a card should show: a fresh shared entry wins over the
// snapshot the post arrived with.
export function resolveFollowing(
  entry: FollowStateEntry | undefined,
  snapshot: boolean,
  now = Date.now()
): boolean {
  if (entry && now - entry.updatedAt <= FOLLOW_STATE_TTL_MS) {
    return entry.following;
  }
  return snapshot;
}
