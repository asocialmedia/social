"use client";

import { useMemo, useSyncExternalStore } from "react";

import { messageDecryptor } from "@/lib/messages/decryptor";

import type {
  SharedContentIndex,
  SharedContentMessage,
} from "./conversation-shared-content";
import { buildConversationSharedContentIndex } from "./conversation-shared-content";

// Derives the conversation's shared posts and shared links from the loaded
// transcript, for the details panel's Posts and Links tabs.
//
// Recomputation is driven by the decryptor's external-store revision, so a
// message finishing decrypting rebuilds the index without touching the
// transcript's own row subscriptions. `window.location.origin` is read at build
// time rather than at module scope so an in-app post link is recognised by host
// on the dev origin as well as in production.
export function useConversationSharedContent(
  messages: readonly SharedContentMessage[]
): SharedContentIndex {
  const revision = useSyncExternalStore(
    messageDecryptor.subscribe,
    () => messageDecryptor.getVersion(),
    () => 0
  );
  const origin = useMemo(
    () => (typeof window === "undefined" ? undefined : window.location.origin),
    []
  );

  return useMemo(
    () =>
      buildConversationSharedContentIndex(
        messages,
        (id) => messageDecryptor.get(id),
        origin,
        revision
      ),
    [messages, origin, revision]
  );
}
