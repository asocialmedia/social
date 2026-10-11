"use client";

import { useMemo, useSyncExternalStore } from "react";

import { messageDecryptor } from "@/lib/messages/decryptor";

import type {
  ConversationMediaIndex,
  ConversationMediaMessage,
  ConversationMediaWindow,
} from "./message-conversation-media";
import {
  buildConversationMediaIndex,
  buildConversationMediaWindow,
} from "./message-conversation-media";

// Derives the conversation-wide media index from the loaded transcript, so the
// fullscreen viewer can page through every image in the thread.
//
// Recomputation is driven by the decryptor's external-store revision: when a
// message finishes decrypting the hook re-renders and rebuilds the index. The
// transcript's own row subscriptions stay separate, so a completion batch only
// re-renders the index, not the visible transcript.
export function useConversationMediaIndex(
  messages: readonly ConversationMediaMessage[]
): ConversationMediaIndex {
  const revision = useSyncExternalStore(
    messageDecryptor.subscribe,
    () => messageDecryptor.getVersion(),
    () => 0
  );

  return useMemo(
    () =>
      buildConversationMediaIndex(
        messages,
        (id) => messageDecryptor.get(id),
        revision
      ),
    [messages, revision]
  );
}

export function useConversationMediaWindow(
  messages: readonly ConversationMediaMessage[],
  anchorKey: string,
  limit?: number
): ConversationMediaWindow {
  const revision = useSyncExternalStore(
    messageDecryptor.subscribe,
    () => messageDecryptor.getVersion(),
    () => 0
  );

  return useMemo(
    () =>
      buildConversationMediaWindow(
        messages,
        (id) => messageDecryptor.get(id),
        anchorKey,
        revision,
        limit
      ),
    [anchorKey, limit, messages, revision]
  );
}
