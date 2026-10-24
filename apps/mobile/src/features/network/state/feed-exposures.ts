import { create } from "zustand";

export const useFeedExposures = create<{
  seen: Record<string, ReadonlySet<string>>;
  remember: (viewer: string, ids: readonly string[]) => void;
}>((set) => ({
  remember: (viewer, ids) =>
    set((state) => {
      const previous = state.seen[viewer] ?? new Set<string>();
      if (ids.every((id) => previous.has(id))) {
        return state;
      }
      return {
        seen: {
          ...state.seen,
          [viewer]: new Set([...previous, ...ids].slice(-1000)),
        },
      };
    }),
  seen: {},
}));
export const EMPTY_EXPOSURES: ReadonlySet<string> = new Set();
