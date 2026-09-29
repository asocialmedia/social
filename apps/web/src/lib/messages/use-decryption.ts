"use client";

import { useMemo } from "react";

import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { createRootKeyStore } from "@/lib/messages/client";
import type { EncryptedBlob } from "@/lib/messages/crypto";
import type { MessageConversationData } from "@/lib/messages/types";

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

// Every wrap belonging to `userId`, so the root-key store can offer one root
// per root-key epoch (identity reset appends a new one). Newest first.
export function findMyWrappedKeys(
  keys: {
    encryptedKey: EncryptedBlob;
    ownerUserId: string;
    version?: number;
  }[],
  userId: string
): { encryptedKey: EncryptedBlob; version: number }[] {
  return keys
    .filter((key) => key.ownerUserId === userId)
    .toSorted((left, right) => (right.version ?? 1) - (left.version ?? 1))
    .map(({ encryptedKey, version }) => ({
      encryptedKey,
      version: version ?? 1,
    }));
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
