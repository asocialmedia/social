// Per-post alt-text visibility for feed lists.
//
// The home feed used to keep a `ReadonlySet<string>` in component state and
// pass `showAlt` down through `renderItem`, so one alt toggle recreated the
// row renderer and re-rendered every mounted card mid-scroll — the main memo
// defeat on long feeds. The store keeps the same per-post booleans, but each
// row subscribes to its own id, so only the toggled card re-renders.
import { create } from "zustand";

interface AltVisibilityState {
  ids: ReadonlySet<string>;
  toggle: (postId: string) => void;
}

export const useAltVisibilityStore = create<AltVisibilityState>()((set) => ({
  ids: new Set<string>(),
  toggle: (postId) =>
    set((state) => {
      const next = new Set(state.ids);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return { ids: next };
    }),
}));

// A row's own alt flag. Selector returns a boolean, so the row re-renders
// only when its own post toggles, never on a neighbour's.
export function useAltVisible(postId: string): boolean {
  return useAltVisibilityStore((state) => state.ids.has(postId));
}
