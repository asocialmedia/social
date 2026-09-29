"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  fetchIdentity,
  resetMessageIdentity,
  saveIdentity,
} from "@/lib/messages/client";
import type { MessageIdentityPayload } from "@/lib/messages/client";
import {
  KDF_ITERATIONS,
  clearStoredPrivateKey,
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
  setStoredPrivateKey,
} from "@/lib/messages/crypto";

export type IdentityStatus = "loading" | "ready" | "error" | "locked";

// Raised when a server-side identity exists but neither derivation produced the
// backup key: the row is corrupt, or it belongs to the short-lived "verifier"
// scheme and this device no longer holds its raw secret. Distinct from a
// genuine bootstrap failure so the UI can offer an accountable reset instead of
// a dead "reload to try again" message.
export class MessageIdentityLockedError extends Error {
  override name = "MessageIdentityLockedError";
}

interface MessageIdentityContextValue {
  error: string | null;
  identity: MessageIdentityPayload | null;
  privateKey: CryptoKey | null;
  status: IdentityStatus;
  // Destroys this account's server identity + own key wraps and provisions a
  // fresh one. The recovery path when a row cannot be read here. The caller
  // must have already confirmed with the user: existing messages become
  // unreadable to this account (the peer's copy is unaffected).
  reset: () => Promise<void>;
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
  // Serializes bootstrap: `bootstrap` is recreated when the session user
  // changes, and a re-render can otherwise start a second pass that races the
  // first (two concurrent provisions mint different keypairs, and the loser
  // then cannot unlock the winner's row). One pass at a time.
  const bootstrappingRef = useRef(false);

  // Decrypts the backup with `masterKey`, imports the private key, and caches
  // it on this device. Shared by both unlock derivations.
  const persistUnlockedKey = useCallback(
    async (
      userId: string,
      masterKey: CryptoKey,
      blob: { ciphertext: string; iv: string }
    ): Promise<void> => {
      const decrypted = await decryptWithMasterKey(masterKey, blob);
      const key = await importPrivateKeyJwk(JSON.parse(decrypted));
      await setStoredPrivateKey(userId, await exportPrivateKeyJwk(key));
      setPrivateKey(key);
    },
    []
  );

  // Provisions a fresh identity: keypair plus a random per-identity seed. Only
  // the seed's SHA-256 hash is sent to the server, and the backup key is
  // derived from that hash — so the stored row alone can always re-derive the
  // backup key. That is what makes recovery automatic on a new device; it also
  // means a database reader can decrypt the backup (see crypto.ts).
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

  // Decrypts the backed-up private key and remembers it on this device.
  //
  // Current rows derive the backup key from the stored hash, so this succeeds
  // with no user input on any device. Verifier-scheme rows instead encrypted
  // under a raw secret that lived only on one device; those still unlock when
  // that secret is present here. Only when neither derivation works does this
  // raise MessageIdentityLockedError.
  const unlockIdentity = useCallback(
    async (identityToUnlock: MessageIdentityPayload): Promise<void> => {
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
        throw new MessageIdentityLockedError(
          "This device can't read its messages key"
        );
      }

      // Legacy verifier row: the backup key came from the raw secret, so try
      // the copy this device still holds (if any) before the row derivation.
      const deviceSecret = getStoredAccountSecret(user.id);
      if (deviceSecret) {
        try {
          const verifier = await hashAccountSecret(deviceSecret);
          if (
            verifier.toLowerCase() ===
            identityToUnlock.masterKeyHash.toLowerCase()
          ) {
            const secretKey = await deriveMasterKey(
              deviceSecret,
              saltBytes,
              identityToUnlock.kdfIterations
            );
            await persistUnlockedKey(user.id, secretKey, { ciphertext, iv });
            setStatus("ready");
            return;
          }
        } catch {
          // Fall through to the stored-hash derivation below.
        }
      }

      // Current (and original) rows: the stored hash IS the KDF input, so the
      // row alone is enough.
      try {
        const masterKey = await deriveMasterKey(
          identityToUnlock.masterKeyHash,
          saltBytes,
          identityToUnlock.kdfIterations
        );
        await persistUnlockedKey(user.id, masterKey, { ciphertext, iv });
        setStatus("ready");
      } catch {
        throw new MessageIdentityLockedError(
          "This device can't read its messages key"
        );
      }
    },
    [persistUnlockedKey, user]
  );

  // The bootstrap body, split out so the caller can reset its in-flight guard
  // without a `try/finally` (the React Compiler cannot lower a `finally`).
  const runBootstrap = useCallback(async () => {
    if (!user) {
      // Guests have no identity to load; settle into a terminal ready state
      // so consumers (e.g. the share picker) do not hang on "loading".
      setStatus("ready");
      return;
    }
    // A device that already unlocked keeps the private key in storage so the
    // browser does not have to re-decrypt the backup every session.
    const stored = await getStoredPrivateKey(user.id);
    if (stored) {
      const key = await importPrivateKeyJwk(stored);
      setPrivateKey(key);
      setStatus("ready");
      return;
    }

    const data = await fetchIdentity();
    if (!data.identity) {
      // No usable identity: provision one automatically.
      await enableIdentity();
      return;
    }
    setIdentity(data.identity);
    await unlockIdentity(data.identity);
  }, [enableIdentity, unlockIdentity, user]);

  const bootstrap = useCallback(async () => {
    if (typeof window === "undefined" || bootstrappingRef.current) {
      return;
    }
    bootstrappingRef.current = true;
    try {
      await runBootstrap();
    } catch (error) {
      // A locked identity is an expected, recoverable state (the user can reset
      // it), not a bootstrap fault, so it must not log as a scary console error
      // or offer only "reload".
      if (error instanceof MessageIdentityLockedError) {
        setIdentityError(error.message);
        setStatus("locked");
      } else {
        console.error("Failed to bootstrap messages identity:", error);
        setIdentityError(
          error instanceof Error ? error.message : "Failed to load identity"
        );
        setStatus("error");
      }
    }
    bootstrappingRef.current = false;
  }, [runBootstrap]);

  useEffect(() => {
    // Defer the (async) bootstrap so the effect body never calls setState
    // synchronously; avoids cascading renders flagged by the compiler rule.
    const timer = setTimeout(() => {
      void bootstrap();
    }, 0);
    return () => clearTimeout(timer);
  }, [bootstrap]);

  // Destroys the stored identity and this account's own conversation-key wraps,
  // clears every device-local copy, then re-provisions. Used only after the
  // user has been warned that pre-reset messages become unreadable to them; the
  // peer's wraps are untouched by the server, so their history survives.
  const reset = useCallback(async (): Promise<void> => {
    if (!user) {
      return;
    }
    await resetMessageIdentity();
    // Clear the cached private key and any leftover verifier-scheme secret so
    // the fresh identity starts from nothing.
    await clearStoredPrivateKey(user.id);
    setPrivateKey(null);
    setIdentity(null);
    setIdentityError(null);
    // Provision the replacement. bootstrap sees no local key and no server
    // identity, so it mints a fresh keypair.
    await bootstrap();
  }, [bootstrap, user]);

  const value = useMemo(
    () => ({
      error: identityError,
      identity,
      privateKey,
      reset,
      status,
    }),
    [identity, identityError, privateKey, reset, status]
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
