import { create } from "zustand";

import type { ComposerCommunityTarget } from "./composer-store";

// The community the reader is currently inside, published by the community
// page while it is mounted.
//
// Why a store rather than reading the path: the compose triggers live in the
// persistent app chrome (the left sidebar and the mobile dock), which does not
// re-render with the route and has no access to the page's loaded community.
// The page knows the full target (id, name, slug, accent) and whether the
// viewer may post there, so it publishes that here and the buttons read it.
//
// `canPost` is carried because a community-scoped composer is only correct for
// a member: a non-member browsing a community must still get the global
// composer, or the post would fail on submit.
interface ActiveCommunityState {
  canPost: boolean;
  community: ComposerCommunityTarget | null;
  clearActiveCommunity: () => void;
  setActiveCommunity: (
    community: ComposerCommunityTarget | null,
    canPost: boolean
  ) => void;
}

export const useActiveCommunityStore = create<ActiveCommunityState>()(
  (set) => ({
    canPost: false,
    clearActiveCommunity: () => set({ canPost: false, community: null }),
    community: null,
    setActiveCommunity: (community, canPost) => set({ canPost, community }),
  })
);
