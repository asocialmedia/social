import { create } from "zustand";

interface ComposerState {
  closeComposer: () => void;
  isOpen: boolean;
  openComposer: () => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
  isOpen: false,
  openComposer: () => set({ isOpen: true }),
  closeComposer: () => set({ isOpen: false }),
}));
