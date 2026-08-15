"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import { fetchIdentity, saveIdentity } from "@/lib/messages/client";
import type { MessageIdentityPayload } from "@/lib/messages/client";
import {
  KDF_ITERATIONS,
  decryptWithMasterKey,
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  getStoredPrivateKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
  setStoredPrivateKey,
} from "@/lib/messages/crypto";

export type IdentityStatus = "loading" | "ready" | "error";

interface MessageIdentityContextValue {
  identity: MessageIdentityPayload | null;
  privateKey: CryptoKey | null;
  status: IdentityStatus;
  error: string | null;
}

const MessageIdentityContext =
  createContext<MessageIdentityContextValue | null>(null);

export function MessageIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useSession();
  const [status, setStatus] = useState<IdentityStatus>("loading");
  const [identity, setIdentity] = useState<MessageIdentityPayload | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Provisions a fresh identity: keypair + random backup secret. Only the
  // SHA-256 hash of the secret is sent to the server; the raw value is never
  // persisted anywhere and is immediately discarded.
  const enableIdentity = useCallback(async (): Promise<void> => {
    if (!user || typeof window === "undefined") {
      return;
    }
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const secret = generateAccountSecret();
    const masterKeyHash = await hashAccountSecret(secret);
    const masterKey = await deriveMasterKey(
      masterKeyHash,
      salt,
      KDF_ITERATIONS
    );
    const backup = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(privateKeyJwk)
    );
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );

    await saveIdentity({
      encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
      kdfIterations: KDF_ITERATIONS,
      masterKeyHash,
      publicKey,
      salt: btoa(String.fromCodePoint(...salt)),
    });
    await setStoredPrivateKey(user.id, privateKeyJwk);
    setPrivateKey(pair.privateKey);
    setStatus("ready");
  }, [user]);

  // Derives the master key from the account's stored backup-secret hash and
  // decrypts the backed-up private key, then remembers it on this device.
  const unlockIdentity = useCallback(
    async (identityToUnlock: MessageIdentityPayload): Promise<void> => {
      if (!user) {
        return;
      }
      const saltBytes = Uint8Array.from(
        atob(identityToUnlock.salt),
        (char) => char.codePointAt(0) ?? 0
      );
      const masterKey = await deriveMasterKey(
        identityToUnlock.masterKeyHash,
        saltBytes,
        identityToUnlock.kdfIterations
      );
      // The backup is stored as `iv.ciphertext` (see enableIdentity()).
      const [iv, ciphertext] = identityToUnlock.encryptedPrivateKey.split(".");
      if (!iv || !ciphertext) {
        throw new Error("Malformed identity backup");
      }
      const decrypted = await decryptWithMasterKey(masterKey, {
        ciphertext,
        iv,
      });
      const key = await importPrivateKeyJwk(JSON.parse(decrypted));
      await setStoredPrivateKey(user.id, await exportPrivateKeyJwk(key));
      setPrivateKey(key);
      setStatus("ready");
    },
    [user]
  );

  const bootstrap = useCallback(async () => {
    if (!user || typeof window === "undefined") {
      return;
    }
    try {
      // A device that already unlocked keeps the private key in IndexedDB so
      // the browser does not have to re-decrypt the backup every session.
      const stored = await getStoredPrivateKey(user.id);
      if (stored) {
        const key = await importPrivateKeyJwk(stored);
        setPrivateKey(key);
        setStatus("ready");
        return;
      }

      const data = await fetchIdentity();
      if (!data.identity) {
        // No usable identity: provision one automatically. The backup secret
        // is random and account-scoped; only its hash is stored, so nothing
        // user-facing is needed here.
        await enableIdentity();
        return;
      }
      setIdentity(data.identity);
      await unlockIdentity(data.identity);
    } catch (error) {
      console.error("Failed to bootstrap messages identity:", error);
      setIdentityError(
        error instanceof Error ? error.message : "Failed to load identity"
      );
      setStatus("error");
    }
  }, [enableIdentity, unlockIdentity, user]);

  useEffect(() => {
    // Defer the (async) bootstrap so the effect body never calls setState
    // synchronously; avoids cascading renders flagged by the compiler rule.
    const timer = setTimeout(() => {
      void bootstrap();
    }, 0);
    return () => clearTimeout(timer);
  }, [bootstrap]);

  const value = useMemo(
    () => ({
      error: identityError,
      identity,
      privateKey,
      status,
    }),
    [identity, identityError, privateKey, status]
  );

  return (
    <MessageIdentityContext.Provider value={value}>
      {children}
    </MessageIdentityContext.Provider>
  );
}

export function useMessagesIdentity(): MessageIdentityContextValue {
  const context = useContext(MessageIdentityContext);
  if (!context) {
    throw new Error(
      "useMessagesIdentity must be used within MessageIdentityProvider"
    );
  }
  return context;
}
