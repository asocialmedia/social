// Persisted collapsed state for the messages left sidebar.
//
// The collapse state lives in a persisted Zustand store so the user's choice
// stays consistent across page reloads and deep links into conversations.

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MessagesSidebarState {
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
}

export const useMessagesSidebarStore = create<MessagesSidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      toggleCollapsed: () =>
        set((state) => ({ isCollapsed: !state.isCollapsed })),
    }),
    {
      name: "messages-sidebar-collapsed",
    }
  )
);
