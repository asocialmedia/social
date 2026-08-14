import { create } from "zustand";

export type ComposerMode = "post" | "gust";

interface ComposerState {
  closeComposer: () => void;
  isOpen: boolean;
  mode: ComposerMode;
  openComposer: (mode?: ComposerMode) => void;
  setMode: (mode: ComposerMode) => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
  closeComposer: () => set({ isOpen: false }),
  isOpen: false,
  mode: "post",
  openComposer: (mode = "post") => set({ isOpen: true, mode }),
  setMode: (mode) => set({ mode }),
}));
