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
  getStoredAccountSecret,
  getStoredPrivateKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
  setStoredAccountSecret,
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

  // Provisions a fresh identity: keypair + random backup secret. The server
  // receives only the SHA-256 hash of the secret, which acts as a VERIFIER:
  // the master key is derived from the raw secret itself, so the stored row
  // alone can never decrypt the backup. The raw secret persists only in this
  // device's storage; unlocking on a NEW device requires the user to supply
  // it.
  const enableIdentity = useCallback(async (): Promise<void> => {
    if (!user || typeof window === "undefined") {
      return;
    }
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const secret = generateAccountSecret();
    // Verifier only: proves knowledge of the secret without enabling
    // derivation (SHA-256 preimage resistance).
    const masterKeyHash = await hashAccountSecret(secret);
    // KDF input is the RAW secret, never the stored hash.
    const masterKey = await deriveMasterKey(secret, salt, KDF_ITERATIONS);
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
    setStoredAccountSecret(user.id, secret);
    await setStoredPrivateKey(user.id, privateKeyJwk);
    setPrivateKey(pair.privateKey);
    setStatus("ready");
  }, [user]);

  // Decrypts the backed-up private key and remembers it on this device.
  //
  // v2 rows (current): the master key derives from the RAW backup secret,
  // which must come from this device's storage or from user input. The
  // stored masterKeyHash is verified against it before use.
  // Legacy rows: identities created before the verifier redesign derived the
  // master key from the stored hash itself; those still unlock automatically
  // until re-provisioned.
  const unlockIdentity = useCallback(
    async (
      identityToUnlock: MessageIdentityPayload,
      suppliedSecret?: string
    ): Promise<void> => {
      if (!user) {
        return;
      }
      const saltBytes = Uint8Array.from(
        atob(identityToUnlock.salt),
        (char) => char.codePointAt(0) ?? 0
      );
      // The backup is stored as `iv.ciphertext` (see enableIdentity()).
      const [iv, ciphertext] = identityToUnlock.encryptedPrivateKey.split(".");
      if (!iv || !ciphertext) {
        throw new Error("Malformed identity backup");
      }

      const deviceSecret = suppliedSecret ?? getStoredAccountSecret(user.id);

      if (deviceSecret) {
        const verifier = await hashAccountSecret(deviceSecret);
        if (
          verifier.toLowerCase() ===
          identityToUnlock.masterKeyHash.toLowerCase()
        ) {
          // v2 path: derive from the raw secret after verifying knowledge of it.
          const masterKey = await deriveMasterKey(
            deviceSecret,
            saltBytes,
            identityToUnlock.kdfIterations
          );
          try {
            const decrypted = await decryptWithMasterKey(masterKey, {
              ciphertext,
              iv,
            });
            const key = await importPrivateKeyJwk(JSON.parse(decrypted));
            await setStoredPrivateKey(user.id, await exportPrivateKeyJwk(key));
            setPrivateKey(key);
            setStatus("ready");
            return;
          } catch {
            // Hash matched but decryption failed: fall through so legacy
            // rows (where the "verifier" doubles as the KDF input) still
            // unlock below.
          }
        }
        // Secret known to this device but hash mismatch: it belongs to an
        // older provisioned identity. Legacy derivation below may apply.
      }

      // Legacy path (pre-verifier rows): the stored hash IS the KDF input.
      try {
        const legacyMasterKey = await deriveMasterKey(
          identityToUnlock.masterKeyHash,
          saltBytes,
          identityToUnlock.kdfIterations
        );
        const decrypted = await decryptWithMasterKey(legacyMasterKey, {
          ciphertext,
          iv,
        });
        const key = await importPrivateKeyJwk(JSON.parse(decrypted));
        await setStoredPrivateKey(user.id, await exportPrivateKeyJwk(key));
        setPrivateKey(key);
        setStatus("ready");
      } catch {
        throw new Error(
          "Backup secret required: enter your messages recovery secret to unlock on this device"
        );
      }
    },
    [user]
  );

  const bootstrap = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }
    if (!user) {
      // Guests have no identity to load; settle into a terminal ready state so
      // consumers (e.g. the share picker) do not hang on "loading" forever.
      setStatus("ready");
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
