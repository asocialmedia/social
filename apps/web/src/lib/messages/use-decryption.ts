"use client";

import type { MessageConversationData } from "@asm/db";
import { useMemo } from "react";

import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import {
  createRootKeyStore,
  decryptMessagePayload,
} from "@/lib/messages/client";
import type { EncryptedBlob, MessagePayload } from "@/lib/messages/crypto";

// A memoized root-key store that lives for the lifetime of the unlocked
// private key. Unwrapping a conversation key is a one-time ECDH+HKDF per
// conversation per session; the store caches the result.
export function useRootKeyStore() {
  const { privateKey } = useMessagesIdentity();
  return useMemo(
    () => (privateKey ? createRootKeyStore(privateKey) : null),
    [privateKey]
  );
}

// The wrapped root key belonging to `userId` in a conversation.
export function findMyWrappedKey(
  keys: { encryptedKey: EncryptedBlob; ownerUserId: string }[],
  userId: string
): EncryptedBlob | null {
  const mine = keys.find((key) => key.ownerUserId === userId);
  return mine?.encryptedKey ?? null;
}

// The other member's public identity key (base64).
export function findPeerPublicKey(
  conversation: MessageConversationData,
  userId: string
): string | null {
  const peer = conversation.members.find(
    (member) => member.userId !== userId && member.user.id !== userId
  );
  const publicKey = peer?.user.messageIdentity?.publicKey;
  return typeof publicKey === "string" && publicKey.length > 0
    ? publicKey
    : null;
}

// Decrypts a message payload given the conversation context. Returns null
// when the key is missing or the ciphertext is invalid (e.g. an identity key
// change left the conversation undecryptable).
export async function decryptMessageWithRootKey(
  rootKeyStore: ReturnType<typeof createRootKeyStore> | null,
  conversation: MessageConversationData,
  userId: string,
  message: {
    ciphertext: string;
    conversationId: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  }
): Promise<MessagePayload | null> {
  if (!rootKeyStore) {
    return null;
  }
  try {
    const wrapped = findMyWrappedKey(
      conversation.keys.map((key) => ({
        encryptedKey: { ciphertext: key.encryptedKey, iv: key.iv },
        ownerUserId: key.ownerUserId,
      })),
      userId
    );
    const peerPublicKey = findPeerPublicKey(conversation, userId);
    if (!wrapped || !peerPublicKey) {
      return null;
    }
    const rootKey = await rootKeyStore.getRootKey(
      conversation.id,
      wrapped,
      peerPublicKey
    );
    return decryptMessagePayload(
      rootKey,
      message.senderId,
      conversation.id,
      message
    );
  } catch (error) {
    console.error("Failed to decrypt message:", error);
    return null;
  }
}
