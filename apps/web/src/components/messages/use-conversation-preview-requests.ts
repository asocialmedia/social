"use client";

import { useCallback, useEffect } from "react";

import { useSession } from "@/app/(main)/session-provider";
import type { ConversationListItem } from "@/lib/messages/client";
import { toWrappedKeyPayloads } from "@/lib/messages/client";
import { importRatchetBaseKey } from "@/lib/messages/crypto";
import { messageDecryptor } from "@/lib/messages/decryptor";
import {
  findMyWrappedKeys,
  findPeerPublicKey,
  useRootKeyStore,
} from "@/lib/messages/use-decryption";

// Asks the shared decryptor for the last message of every conversation in the
// list, so each row can show what was said without the reader opening anything.
//
// The server stores only ciphertext, so a preview is a decrypt like any other;
// this is the request half. The rows themselves read their own entry with
// `useDecryptEntry`, which is the same per-row subscription the transcript uses --
// that way a batch of completions re-renders only the rows whose previews landed,
// rather than the whole list once per completion.
//
// Using the session-wide decryptor rather than one of its own is deliberate. It is
// already the app's one cache of decrypted payloads, it is already capped and
// scope-aware, and a second one would double the WebCrypto work for a message the
// reader is about to open anyway (the thread asks for exactly the same row).
export function useConversationPreviewRequests(
  items: readonly ConversationListItem[]
): void {
  const { user } = useSession();
  const rootKeyStore = useRootKeyStore();
  const userId = user?.id;

  // Same scope the thread sets, so a payload decrypted here is not served to a
  // different identity and the reset path clears it. Idempotent when the thread
  // has already called it.
  useEffect(() => {
    messageDecryptor.configureScope(userId ?? "anonymous");
  }, [userId]);

  // Resolves the ratchet base keys for one conversation out of the row the list
  // already carries: my wrapped keys and the peer's public key are both on it, so a
  // preview costs one ECDH unwrap per conversation, cached by the root-key store
  // for the session.
  const getBaseKeys = useCallback(
    async (targetConversationId: string): Promise<CryptoKey[]> => {
      if (!rootKeyStore || !userId) {
        return [];
      }
      const item = items.find(
        (candidate) => candidate.conversation.id === targetConversationId
      );
      if (!item) {
        return [];
      }
      const peerPublicKey = findPeerPublicKey(item.conversation, userId);
      // The list carries the raw key ROWS (`encryptedKey` and `iv` as sibling
      // strings), not the client's wrapped-key payload with the blob nested, so
      // they are adapted rather than translated on the server for the sake of a
      // preview.
      const wrappedKeys = findMyWrappedKeys(
        toWrappedKeyPayloads(item.conversation.keys),
        item.conversation,
        userId
      );
      if (wrappedKeys.length === 0) {
        return [];
      }
      try {
        const roots = await rootKeyStore.getRootKeys(
          targetConversationId,
          wrappedKeys,
          // Only a DM needs the peer: a den wrap pairs with its own wrapper.
          peerPublicKey ?? ""
        );
        return await Promise.all(roots.map(importRatchetBaseKey));
      } catch {
        // No unwrappable epoch for this conversation: the row shows no preview
        // rather than a wrong one, and opening the thread reports the real problem.
        return [];
      }
    },
    [items, rootKeyStore, userId]
  );

  useEffect(() => {
    if (!rootKeyStore || !userId) {
      return;
    }
    const batch = items.flatMap((item) => {
      const { lastMessage } = item;
      // A deleted message previews from the row alone, so decrypting it would be
      // work whose result is thrown away.
      if (!lastMessage || lastMessage.deletedAt) {
        return [];
      }
      return [
        {
          conversationId: item.conversation.id,
          message: {
            ciphertext: lastMessage.ciphertext,
            id: lastMessage.id,
            iv: lastMessage.iv,
            ratchetIndex: lastMessage.ratchetIndex,
            senderId: lastMessage.senderId,
          },
        },
      ];
    });
    if (batch.length > 0) {
      // `request` is idempotent for cached, queued and in-flight ids, so a
      // refetch that re-renders the list does not re-decrypt the same rows.
      messageDecryptor.request(batch, { getBaseKeys });
    }
  }, [getBaseKeys, items, rootKeyStore, userId]);
}
