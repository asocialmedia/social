// Composer open/close state, ported from web's store/composer-store.ts.
// Passing a reply target opens a Respond (a threaded post reply): it forces
// fleet mode, since responses are always fleets.
import { create } from "zustand";

import type { FeedMedia, FeedPost } from "@/features/feed/lib/feed-types";

import type { MentionPick } from "../lib/inline-relations";

export type ComposerMode = "gust" | "post";

export interface ReplyTarget {
  attachments?: FeedMedia[];
  avatarUrl: string | null;
  badge?: string | null;
  badges?: string[] | null;
  content: string;
  createdAt: string;
  displayName: string | null;
  id: string;
  isGust?: boolean;
  username: string;
}

// The in-progress text and autocomplete picks survive closing the composer
// (web keeps its attachments across a close the same way); publishing or
// discarding clears them.
export interface ComposerDraft {
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
  open: (mode = "post", replyTo = null) =>
    set({ isOpen: true, mode: replyTo ? "post" : mode, replyTo }),
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
    content: post.content ?? "",
    createdAt: post.createdAt,
    displayName: post.user?.displayName ?? null,
    id: post.id,
    isGust: post.isGust ?? false,
    username: post.user?.username ?? "",
  };
}
