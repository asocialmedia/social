import { create } from "zustand";

interface SectionLocation {
  chatHref?: string;
  postsHref?: string;
}

interface CommunitySectionState {
  locations: Record<string, SectionLocation>;
  remember: (scope: string, location: SectionLocation) => void;
}

export const communitySectionScope = (
  viewerId: string | undefined,
  slug: string
) => JSON.stringify([viewerId ?? "guest", slug]);

// Session-only and bounded; account scopes never share return destinations.
export const useCommunitySectionStore = create<CommunitySectionState>()(
  (set) => ({
    locations: {},
    remember: (scope, location) =>
      set((state) => {
        const previous = state.locations[scope];
        const next = { ...previous, ...location };
        if (
          previous?.chatHref === next.chatHref &&
          previous?.postsHref === next.postsHref
        ) {
          return state;
        }
        const entries: [string, SectionLocation][] = Object.entries(
          state.locations
        ).filter(([key]) => key !== scope);
        entries.push([scope, next]);
        const locations = Object.fromEntries(entries.slice(-32));
        return { locations };
      }),
  })
);
