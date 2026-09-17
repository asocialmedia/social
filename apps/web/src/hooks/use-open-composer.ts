"use client";

import { useCallback } from "react";

import { useActiveCommunityStore } from "@/store/active-community-store";
import { useComposerStore } from "@/store/composer-store";

// The one rule every compose trigger follows: if the reader is inside a
// community they can post to, the composer opens scoped to it (and banners
// "Posting in a/slug"); otherwise it opens the global composer.
//
// Lives here so the left sidebar and the mobile dock cannot drift apart, and
// so a third trigger later inherits the behaviour for free.
export function useOpenComposer() {
  const openComposer = useComposerStore((state) => state.openComposer);
  const openComposerInCommunity = useComposerStore(
    (state) => state.openComposerInCommunity
  );
  const community = useActiveCommunityStore((state) => state.community);
  const canPost = useActiveCommunityStore((state) => state.canPost);

  return useCallback(() => {
    if (community && canPost) {
      openComposerInCommunity(community);
      return;
    }
    openComposer();
  }, [canPost, community, openComposer, openComposerInCommunity]);
}
