// Composer open/close state, ported from web's store/composer-store.ts.
// Passing a reply target opens a Respond (a threaded post reply): it forces
// fleet mode, since responses are always fleets.
import { create } from "zustand";

import type {
  FeedMedia,
  FeedPost,
  FeedUser,
} from "@/features/feed/lib/feed-types";
import { haptic } from "@/lib/haptics";

import {
  draftForComposerOpen,
  draftWithContext,
} from "../lib/composer-context";
import type { ComposerContext } from "../lib/composer-context";
import type { MentionPick } from "../lib/inline-relations";

export type ComposerMode = "gust" | "post";

export interface ReplyTarget {
  externalParentUri?: string;
  attachments?: FeedMedia[];
  avatarUrl: string | null;
  badge?: string | null;
  badges?: string[] | null;
  content: string;
  createdAt: string;
  displayName: string | null;
  id: string;
  isGust?: boolean;
  community?: FeedPost["community"];
  communityMemberships?: FeedUser["communityMemberships"];
  embeds?: FeedPost["embeds"];
  hnStoryShare?: FeedPost["hnStoryShare"];
  communityShare?: FeedPost["communityShare"];
  username: string;
}

// The in-progress text and autocomplete picks survive closing the composer
// (web keeps its attachments across a close the same way); publishing or
// discarding clears them.
// The Hacker News story a composer was opened to share, as web sends it.
export interface HnShareDraft {
  by?: string | null;
  descendants?: number | null;
  score?: number | null;
  storyId: number;
  time?: number | null;
  title: string;
  url?: string | null;
}

export interface ComposerDraft {
  gustMentions?: MentionPick[];
  gustTags?: string[];
  // Set when the composer was opened by "Share to feed". The publish carries
  // communitySharePostId so the server records the share side row, and a pure
  // reshare is allowed to have no caption of its own.
  communityId?: string;
  communitySlug?: string;
  communitySharePostId?: string;
  communityShare?: {
    sourcePostId: string;
    slug: string;
    name: string;
    accentColor?: string | null;
  };
  // Set by the Hacker News card's "Reshare as fleet".
  hnStory?: HnShareDraft;
  mentions: MentionPick[];
  tags: string[];
  text: string;
}

const EMPTY_DRAFT: ComposerDraft = { mentions: [], tags: [], text: "" };

interface ComposerState {
  clearDraft: () => void;
  close: () => void;
  draft: ComposerDraft;
  setDraft: (draft: Partial<ComposerDraft>) => void;
  isOpen: boolean;
  mode: ComposerMode;
  open: (mode?: ComposerMode, replyTo?: ReplyTarget | null) => void;
  openWithContext: (context: ComposerContext) => void;
  replyTo: ReplyTarget | null;
  setMode: (mode: ComposerMode) => void;
  clearReplyTo: () => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
  clearReplyTo: () => set({ replyTo: null }),
  close: () => set({ isOpen: false, replyTo: null }),
  draft: EMPTY_DRAFT,
  isOpen: false,
  mode: "post",
  open: (mode = "post", replyTo = null) => {
    haptic();
    set((state) => ({
      draft: draftForComposerOpen(state.draft, mode, replyTo !== null),
      isOpen: true,
      mode: replyTo ? "post" : mode,
      replyTo,
    }));
  },
  openWithContext: (context) => {
    haptic();
    set((state) => ({
      draft: draftWithContext(state.draft, context),
      isOpen: true,
      mode: "post",
      replyTo: null,
    }));
  },
  replyTo: null,
  setDraft: (draft) =>
    set((state) => ({ draft: { ...state.draft, ...draft } })),
  setMode: (mode) => set({ mode }),
}));

export function replyTargetFromPost(post: FeedPost): ReplyTarget {
  return {
    attachments: post.attachments ?? [],
    avatarUrl: post.user?.avatarUrl ?? null,
    badge: post.user?.badge ?? null,
    badges: post.user?.badges ?? null,
    community: post.community,
    communityMemberships: post.user?.communityMemberships,
    communityShare: post.communityShare,
    content: post.content ?? "",
    createdAt: post.createdAt,
    displayName: post.user?.displayName ?? null,
    embeds: post.embeds,
    hnStoryShare: post.hnStoryShare,
    id: post.id,
    isGust: post.isGust ?? false,
    username: post.user?.username ?? "",
  };
}
