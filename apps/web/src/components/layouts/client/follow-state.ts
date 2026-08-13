import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FollowEntry {
  followers: number;
  isFollowing: boolean;
  lastUpdated: number;
}

interface FollowState {
  followMap: Record<string, FollowEntry>;
  setUserFollowState: (userId: string, entry: FollowEntry) => void;
}

export const useFollowStateStore = create<FollowState>()(
  persist(
    (set) => ({
      followMap: {},
      setUserFollowState: (userId, entry) =>
        set((state) => ({
          followMap: { ...state.followMap, [userId]: entry },
        })),
    }),
    {
      name: "follow-state",
    }
  )
);
