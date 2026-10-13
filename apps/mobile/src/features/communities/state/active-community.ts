import { create } from "zustand";

export const activeCommunityStore = create<{
  active: { id: string; slug: string; canPost: boolean } | null;
  set: (active: { id: string; slug: string; canPost: boolean }) => void;
  clear: (slug: string) => void;
}>((set) => ({
  active: null,
  clear: (slug) =>
    set((state) => (state.active?.slug === slug ? { active: null } : state)),
  set: (active) => set({ active }),
}));
