import { create } from "zustand";

interface MessageTextDraftState {
  drafts: Record<string, string>;
  save: (conversationId: string, text: string) => void;
  clear: (conversationId: string) => void;
}
export const useMessageTextDraft = create<MessageTextDraftState>((set) => ({
  clear: (conversationId) =>
    set((state) => ({
      drafts: Object.fromEntries(
        Object.entries(state.drafts).filter(([id]) => id !== conversationId)
      ),
    })),
  drafts: {},
  save: (conversationId, text) =>
    set((state) => ({
      drafts: Object.fromEntries(
        [
          ...Object.entries(state.drafts).filter(
            ([id]) => id !== conversationId
          ),
          [conversationId, text.slice(0, 8000)],
        ].slice(-50)
      ),
    })),
}));
