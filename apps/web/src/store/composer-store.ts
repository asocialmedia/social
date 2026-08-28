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
  // Only an explicit mode argument switches the composer. Bare open calls
  // (sidebar "Post" button, profile compose) preserve the current mode so a
  // restored draft reopens as what it was authored as - a gust video draft
  // must never present itself as a fleet attachment after a refresh.
  openComposer: (mode) => set(mode ? { isOpen: true, mode } : { isOpen: true }),
  setMode: (mode) => set({ mode }),
}));
