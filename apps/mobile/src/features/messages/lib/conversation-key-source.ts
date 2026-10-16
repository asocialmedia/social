import type { ApiCallOptions } from "@/features/feed/lib/feed-api";

// One identity owns one root-key store shared by list previews and all threads.
// Ciphertext, epochs and the peer public key control reuse; plaintext stays in memory.
import {
  createRootKeyStore,
  fetchConversationDetail,
  resolveMyConversationWraps,
} from "./client";
import type { EcdhPrivateKey } from "./crypto-primitives";

export function createConversationKeySource(
  privateKey: EcdhPrivateKey,
  userId: string,
  options: () => Promise<ApiCallOptions>
) {
  const store = createRootKeyStore(privateKey);
  const pending = new Map<string, Promise<Uint8Array[]>>();
  const resolveKeys = async (conversationId: string): Promise<Uint8Array[]> => {
    const detail = await fetchConversationDetail(
      conversationId,
      await options()
    );
    const peer = detail.conversation.members.find(
      (member) => member.userId !== userId
    );
    const publicKey = peer?.user.messageIdentity?.publicKey;
    const wraps = resolveMyConversationWraps(
      detail.keys,
      detail.conversation,
      userId
    );
    const fallback =
      detail.conversation.type === "DEN" ? "" : (publicKey ?? "");
    return store.getRootKeys(conversationId, wraps, fallback);
  };
  const getBaseKeys = (conversationId: string): Promise<Uint8Array[]> => {
    const cached = pending.get(conversationId);
    if (cached) {
      return cached;
    }
    const promise = resolveKeys(conversationId);
    if (pending.size >= 64) {
      const oldest = pending.keys().next().value;
      if (oldest) {
        pending.delete(oldest);
      }
    }
    pending.set(conversationId, promise);
    void (async () => {
      let keys: Uint8Array[] = [];
      try {
        keys = await promise;
      } catch {
        keys = [];
      }
      if (keys.length === 0 && pending.get(conversationId) === promise) {
        pending.delete(conversationId);
      }
    })();
    return promise;
  };
  const invalidate = (conversationId: string) => {
    pending.delete(conversationId);
  };
  return { getBaseKeys, invalidate };
}
