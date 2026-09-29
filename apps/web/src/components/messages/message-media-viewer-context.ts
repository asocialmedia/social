"use client";

import { createContext, useContext } from "react";

// Lets any message media tile open the single conversation-wide viewer owned by
// the thread, without threading a callback through the virtualized transcript
// (which would defeat the row memo comparator).
export interface OpenConversationMediaArgs {
  imageIndex: number;
  messageId: string;
}

export type OpenConversationMedia = (args: OpenConversationMediaArgs) => void;

const ConversationMediaViewerContext =
  createContext<OpenConversationMedia | null>(null);

export const ConversationMediaViewerProvider =
  ConversationMediaViewerContext.Provider;

export function useOpenConversationMedia(): OpenConversationMedia | null {
  return useContext(ConversationMediaViewerContext);
}
