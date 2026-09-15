import type { Media } from "@asm/db";
import { create } from "zustand";

export type ComposerMode = "post" | "gust";

// When the composer is opened from a community page, the post is published
// INTO that community. The composer banners the target and passes its id
// through to submitPost; membership is verified server-side.
export interface ComposerCommunityTarget {
  accentColor: string;
  id: string;
  name: string;
  slug: string;
}

// When the composer is opened to republish a community post onto the global
// feed, the new post carries a CommunityPostShare side row back to the source.
// The source post lives in a community; the new post does not.
export interface ComposerCommunityShareTarget {
  accentColor: string;
  communityName: string;
  communitySlug: string;
  sourcePostId: string;
}

// The post being responded to when the composer is opened as a response. The
// composer renders a full preview of the parent post and publishes with parentPostId.
export interface ComposerReplyTarget {
  attachments?: Media[] | { id: string; type: string; url?: string }[];
  avatarUrl?: string | null;
  badge?: string | null;
  badges?: string[] | null;
  content?: string;
  createdAt?: Date | string;
  displayName?: string;
  embeds?: unknown;
  id: string;
  isGust?: boolean;
  username: string;
}

interface ComposerState {
  clearCommunity: () => void;
  clearCommunityShare: () => void;
  clearReplyTo: () => void;
  closeComposer: () => void;
  community: ComposerCommunityTarget | null;
  communityShare: ComposerCommunityShareTarget | null;
  isOpen: boolean;
  mode: ComposerMode;
  openComposer: (mode?: ComposerMode, replyTo?: ComposerReplyTarget) => void;
  // Opens the composer scoped to a community (native community post). Kept
  // separate from openComposer so existing call sites stay untouched.
  openComposerInCommunity: (community: ComposerCommunityTarget) => void;
  // Opens the composer to reshare a community post onto the global feed.
  openComposerForCommunityShare: (target: ComposerCommunityShareTarget) => void;
  replyTo: ComposerReplyTarget | null;
  setMode: (mode: ComposerMode) => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
  clearCommunity: () => set({ community: null }),
  clearCommunityShare: () => set({ communityShare: null }),
  clearReplyTo: () => set({ replyTo: null }),
  closeComposer: () =>
    set({
      community: null,
      communityShare: null,
      isOpen: false,
      replyTo: null,
    }),
  community: null,
  communityShare: null,
  isOpen: false,
  mode: "post",
  // Only an explicit mode argument switches the composer. Bare open calls
  // (sidebar "Post" button, profile compose) preserve the current mode so a
  // restored draft reopens as what it was authored as - a gust video draft
  // must never present itself as a fleet attachment after a refresh. A reply
  // target forces the fleet mode (responses are never gusts) and carries the
  // parent so the composer can banner it and publish with parentPostId.
  openComposer: (mode, replyTo) => {
    if (replyTo) {
      // Responses are always fleets; the target also carries the parent.
      set({
        community: null,
        communityShare: null,
        isOpen: true,
        mode: "post",
        replyTo,
      });
      return;
    }
    set(
      mode
        ? { community: null, communityShare: null, isOpen: true, mode }
        : { community: null, communityShare: null, isOpen: true }
    );
  },
  openComposerForCommunityShare: (communityShare) =>
    set({
      community: null,
      communityShare,
      isOpen: true,
      mode: "post",
      replyTo: null,
    }),
  openComposerInCommunity: (community) =>
    set({
      community,
      communityShare: null,
      isOpen: true,
      mode: "post",
      replyTo: null,
    }),
  replyTo: null,
  setMode: (mode) => set({ mode }),
}));
