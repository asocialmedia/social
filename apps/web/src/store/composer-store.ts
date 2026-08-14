import { create } from "zustand";

interface ComposerState {
  closeComposer: () => void;
  isOpen: boolean;
  openComposer: () => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
  closeComposer: () => set({ isOpen: false }),
  isOpen: false,
  openComposer: () => set({ isOpen: true }),
}));
