import { create } from "zustand";

interface SharedPostDraftState {
  drafts: Record<string, string>;
  attach: (conversationId: string, postId: string) => void;
  clear: (conversationId: string) => void;
}

export const useSharedPostDraft = create<SharedPostDraftState>((set) => ({
  attach: (conversationId, postId) =>
    set((state) => ({ drafts: { ...state.drafts, [conversationId]: postId } })),
  clear: (conversationId) =>
    set((state) => ({
      drafts: Object.fromEntries(
        Object.entries(state.drafts).filter(([id]) => id !== conversationId)
      ),
    })),
  drafts: {},
}));
