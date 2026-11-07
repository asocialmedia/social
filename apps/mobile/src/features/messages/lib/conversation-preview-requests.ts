// Which last-messages the conversation list asks the shared decryptor to
// preview. Ported from apps/web/src/components/messages/
// use-conversation-preview-requests.ts (the request half).
//
// The server stores only ciphertext, so a list preview is a decrypt like any
// other. Using the session-wide decryptor (rather than a list-owned one) is
// deliberate: it is already the app's one cache of decrypted payloads, already
// capped and scope-aware, and a second one would double the work for a message
// the reader is about to open anyway (the thread asks for exactly the same
// row). Rows read their own entry via their existing per-row subscription, so
// a batch of completions re-renders only the rows whose previews landed.

export interface PreviewRequestMessage {
  ciphertext: string;
  id: string;
  iv: string;
  ratchetIndex: number;
  senderId: string;
}

export interface PreviewRequestBatchItem {
  conversationId: string;
  message: PreviewRequestMessage;
}

// A deleted message previews from the row alone, so decrypting it would be
// work whose result is thrown away. Rows without a last message have nothing
// to preview.
export function previewBatchForItems<
  T extends {
    conversation: { id: string };
    lastMessage: (PreviewRequestMessage & { deletedAt?: unknown }) | null;
  },
>(items: readonly T[]): PreviewRequestBatchItem[] {
  return items.flatMap((item) => {
    const { lastMessage } = item;
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
}
