// Eddie composer state shared across a post's composers:
// - drafts keyed like web's sessionStorage `eddie-draft:{postId}[:{parentId}]`
//   (in memory here), so a half-written eddie survives closing the reply or
//   scrolling the card away
// - the floating bar's reply target on the post screen (web's shared
//   `replyingTo`), set by a row's Reply and cleared by the chip's X
import { create } from "zustand";

export interface EddieReplyTarget {
  commentId: string;
  postId: string;
  preview: string;
  username: string;
}

interface EddieComposerState {
  drafts: Record<string, string>;
  replyingTo: EddieReplyTarget | null;
  setDraft: (key: string, text: string) => void;
  setReplyingTo: (target: EddieReplyTarget | null) => void;
}

export const useEddieComposerStore = create<EddieComposerState>((set) => ({
  drafts: {},
  replyingTo: null,
  setDraft: (key, text) =>
    set((state) => ({ drafts: { ...state.drafts, [key]: text } })),
  setReplyingTo: (target) => set({ replyingTo: target }),
}));

export function eddieDraftKey(
  postId: string,
  parentId?: string | null
): string {
  return parentId
    ? `eddie-draft:${postId}:${parentId}`
    : `eddie-draft:${postId}`;
}
