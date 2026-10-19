import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CommunityNavigationState {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}

export const useCommunityNavigationStore = create<CommunityNavigationState>()(
  persist(
    (set) => ({
      expanded: false,
      setExpanded: (expanded) => set({ expanded }),
    }),
    { name: "community-sidebar-expanded" }
  )
);
