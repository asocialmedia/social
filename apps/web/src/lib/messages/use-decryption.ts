"use client";

import type { MessageConversationData } from "@asm/db";
import { useMemo } from "react";

import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { createRootKeyStore } from "@/lib/messages/client";
import type { EncryptedBlob } from "@/lib/messages/crypto";

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
