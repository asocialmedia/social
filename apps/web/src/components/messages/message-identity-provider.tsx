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
  deriveBackupKeyFromPrf,
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  getStoredAccountSecret,
  getStoredPrivateKey,
  hashAccountSecret,
  hashPrfOutput,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
  setStoredAccountSecret,
  setStoredPrivateKey,
} from "@/lib/messages/crypto";
import {
  enrollRecoveryCredential,
  recoverPrfOutput,
} from "@/lib/messages/recovery-client";
import { buildPasskeyBackup } from "@/lib/messages/recovery-enroll";

export type IdentityStatus = "loading" | "ready" | "error" | "locked";

// Raised when a server-side identity exists but this device cannot derive its
// master key: the raw backup secret is absent (cleared storage, another
// origin, a new device) and the legacy derivation did not apply. Distinct from
// a genuine bootstrap failure so the UI can offer the recovery-secret form
// instead of a dead "reload to try again" message.
export class MessageIdentityLockedError extends Error {
  override name = "MessageIdentityLockedError";
}

interface MessageIdentityContextValue {
  // True when the stored identity has a passkey-encrypted backup copy, so the
  // UI can offer "unlock with passkey" rather than only the manual secret.
  canUsePasskey: boolean;
  error: string | null;
  identity: MessageIdentityPayload | null;
  privateKey: CryptoKey | null;
  status: IdentityStatus;
  // The backup secret generated when this device provisioned a fresh identity.
  // Surfaced once so the user can store it; a lost secret cannot be recovered
  // from the server (only its hash is stored).
  recoverySecret: string | null;
  dismissRecoverySecret: () => void;
  // Enrolls a recovery passkey and stores a second, PRF-encrypted backup copy.
  enrollPasskey: () => Promise<void>;
  // Unlocks using the enrolled recovery passkey (one platform gesture).
  recoverWithPasskey: () => Promise<void>;
  // Unlocks a locked identity with a user-supplied recovery secret, persisting
  // it on this device so the prompt does not recur.
  unlock: (secret: string) => Promise<void>;
  // Destroys this account's server identity + own key wraps and provisions a
  // fresh one. The escape hatch when the recovery secret is gone. The caller
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
  // Set only when this device just minted an identity, so the UI can show the
  // generated secret once. Never persisted to the server.
  const [recoverySecret, setRecoverySecret] = useState<string | null>(null);
  // Serializes bootstrap: `bootstrap` is recreated when the session user
  // changes, and a re-render can otherwise start a second pass that races the
  // first (two concurrent provisions mint different keypairs, and the loser
  // then fails to unlock the winner's row with the "Backup secret required"
  // error). One pass at a time.
  const bootstrappingRef = useRef(false);
  // Guards the one-time secret reveal: once dismissed it must not reappear if
  // the component re-renders (e.g. the user object identity changes).
  const recoverySecretSeenRef = useRef(false);

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
      backupMethod: "manual-secret",
      encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
      kdfIterations: KDF_ITERATIONS,
      masterKeyHash,
      publicKey,
      salt: btoa(String.fromCodePoint(...salt)),
    });
    setStoredAccountSecret(user.id, secret);
    await setStoredPrivateKey(user.id, privateKeyJwk);
    setPrivateKey(pair.privateKey);
    // Surface the secret once so the user can store it off-device. Without
    // this the identity is unrecoverable if local storage is ever cleared:
    // the server keeps only the hash.
    if (!recoverySecretSeenRef.current) {
      setRecoverySecret(secret);
    }
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
        throw new MessageIdentityLockedError(
          "Backup secret required: enter your messages recovery secret to unlock on this device"
        );
      }
    },
    [user]
  );

  // Unlock with a user-supplied recovery secret (the one shown when the
  // identity was first provisioned). On success the secret is persisted to this
  // device so the prompt does not recur, and the private key is cached.
  const unlock = useCallback(
    async (secret: string): Promise<void> => {
      if (!user || !identity) {
        return;
      }
      const trimmed = secret.trim();
      if (!trimmed) {
        throw new MessageIdentityLockedError("Enter your recovery secret");
      }
      await unlockIdentity(identity, trimmed);
      setStoredAccountSecret(user.id, trimmed);
      setIdentityError(null);
    },
    [identity, unlockIdentity, user]
  );

  const dismissRecoverySecret = useCallback(() => {
    recoverySecretSeenRef.current = true;
    setRecoverySecret(null);
  }, []);

  // Decrypts the PRF backup copy and caches the private key. The PRF output is
  // re-derived from the enrolled credential each time (it is never stored); the
  // verifier recorded at enrollment confirms the authenticator returned the
  // expected bytes before we attempt the decryption.
  const unlockWithPrf = useCallback(
    async (identityToUnlock: MessageIdentityPayload): Promise<void> => {
      if (!user) {
        return;
      }
      const backup = identityToUnlock.prfEncryptedPrivateKey;
      if (!backup) {
        throw new MessageIdentityLockedError("No passkey recovery is set up");
      }
      const [iv, ciphertext] = backup.split(".");
      if (!iv || !ciphertext) {
        throw new Error("Malformed passkey backup");
      }
      const prfOutput = await recoverPrfOutput(user.id);
      if (
        identityToUnlock.prfVerifier &&
        (await hashPrfOutput(prfOutput)) !== identityToUnlock.prfVerifier
      ) {
        throw new MessageIdentityLockedError(
          "That passkey doesn't match your messages backup"
        );
      }
      const saltBytes = Uint8Array.from(
        atob(identityToUnlock.salt),
        (char) => char.codePointAt(0) ?? 0
      );
      const prfKey = await deriveBackupKeyFromPrf(
        prfOutput,
        saltBytes,
        identityToUnlock.kdfIterations
      );
      try {
        const decrypted = await decryptWithMasterKey(prfKey, {
          ciphertext,
          iv,
        });
        const key = await importPrivateKeyJwk(JSON.parse(decrypted));
        await setStoredPrivateKey(user.id, await exportPrivateKeyJwk(key));
        setPrivateKey(key);
        setIdentityError(null);
        setStatus("ready");
      } catch {
        throw new MessageIdentityLockedError(
          "Couldn't unlock your messages with that passkey"
        );
      }
    },
    [user]
  );

  // Exposed to the locked screen: retry the passkey flow on user request.
  const recoverWithPasskey = useCallback(async (): Promise<void> => {
    if (!identity) {
      return;
    }
    await unlockWithPrf(identity);
  }, [identity, unlockWithPrf]);

  // Enrolls a recovery credential and stores a SECOND copy of the private key
  // encrypted under its PRF output. The manual-secret backup is left untouched
  // and re-sent as-is, so a device that only holds the recovery secret can
  // still unlock after this runs.
  const enrollPasskey = useCallback(async (): Promise<void> => {
    if (!user || !privateKey || !identity) {
      throw new Error("Messages aren't ready yet");
    }
    const prfOutput = await enrollRecoveryCredential(user.id);
    const backup = await buildPasskeyBackup({
      identity,
      prfOutput,
      privateKey,
    });

    await saveIdentity({
      ...backup,
      encryptedPrivateKey: identity.encryptedPrivateKey,
      kdfIterations: identity.kdfIterations,
      masterKeyHash: identity.masterKeyHash,
      publicKey: identity.publicKey,
      salt: identity.salt,
    });

    setIdentity({ ...identity, ...backup });
  }, [identity, privateKey, user]);

  // The bootstrap body, split out so the caller can reset its in-flight guard
  // without a `try/finally` (the React Compiler cannot lower a `finally`).
  const runBootstrap = useCallback(async () => {
    if (!user) {
      // Guests have no identity to load; settle into a terminal ready state
      // so consumers (e.g. the share picker) do not hang on "loading".
      setStatus("ready");
      return;
    }
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
    // Prefer the passkey copy when it exists: it is the seamless path (one
    // platform gesture, nothing to type). A cancelled or failed prompt falls
    // through to the manual secret, then to the locked state, so this never
    // makes recovery worse than before passkey enrollment.
    if (data.identity.prfEncryptedPrivateKey) {
      try {
        await unlockWithPrf(data.identity);
        return;
      } catch {
        // Fall through to the manual paths below.
      }
    }
    await unlockIdentity(data.identity);
  }, [enableIdentity, unlockIdentity, unlockWithPrf, user]);

  const bootstrap = useCallback(async () => {
    if (typeof window === "undefined" || bootstrappingRef.current) {
      return;
    }
    bootstrappingRef.current = true;
    try {
      await runBootstrap();
    } catch (error) {
      // A locked identity is an expected, recoverable state (the user can
      // supply the secret), not a bootstrap fault, so it must not log as a
      // scary console error or offer only "reload".
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
    // Clear the cached private key and the backup secret so the fresh identity
    // starts from nothing, and arm the one-time reveal for the new secret.
    await clearStoredPrivateKey(user.id);
    recoverySecretSeenRef.current = false;
    setPrivateKey(null);
    setIdentity(null);
    setIdentityError(null);
    setRecoverySecret(null);
    // Provision the replacement. bootstrap sees no local key and no server
    // identity, so it mints a fresh keypair.
    await bootstrap();
  }, [bootstrap, user]);

  const value = useMemo(
    () => ({
      canUsePasskey: Boolean(identity?.prfEncryptedPrivateKey),
      dismissRecoverySecret,
      enrollPasskey,
      error: identityError,
      identity,
      privateKey,
      recoverWithPasskey,
      recoverySecret,
      reset,
      status,
      unlock,
    }),
    [
      dismissRecoverySecret,
      enrollPasskey,
      identity,
      identityError,
      privateKey,
      recoverySecret,
      recoverWithPasskey,
      reset,
      status,
      unlock,
    ]
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
