// Search open/close state, mirroring web's SpotlightProvider and ComposerModal.
import { create } from "zustand";

interface SearchState {
  close: () => void;
  initialQuery: string;
  isOpen: boolean;
  open: (query?: string) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  close: () => set({ initialQuery: "", isOpen: false }),
  initialQuery: "",
  isOpen: false,
  open: (query = "") => set({ initialQuery: query, isOpen: true }),
}));
