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
  refreshIdentityBackup,
  resetMessageIdentity,
  saveIdentity,
} from "@/lib/messages/client";
import type { MessageIdentityPayload } from "@/lib/messages/client";
import {
  KDF_ITERATIONS,
  clearStoredPrivateKey,
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
import {
  refreshLegacyIdentityBackup,
  unlockAndMigrateIdentityBackup,
} from "@/lib/messages/identity-backup";
import { createIdentityScopeBroadcast } from "@/lib/messages/identity-scope-broadcast";
import type { IdentityScopeBroadcast } from "@/lib/messages/identity-scope-broadcast";
import type { OfflineSearchCacheScope } from "@/lib/messages/indexeddb-offline-search-cache";
import { offlineSearchWorkerClient } from "@/lib/messages/offline-search-worker-client";

async function clearLegacySearchIndexScopeForIdentity(
  scope: OfflineSearchCacheScope
): Promise<boolean> {
  try {
    const searchIndexBackend =
      await import("@/lib/messages/search-index-backend");
    return await searchIndexBackend.clearLegacySearchIndexScope(scope);
  } catch {
    return false;
  }
}

export type IdentityStatus = "loading" | "ready" | "error" | "locked";

// Raised when a server-side identity exists but neither derivation produced the
// backup key: the row is corrupt, or it belongs to the short-lived "verifier"
// scheme and this device no longer holds its raw secret. Distinct from a
// genuine bootstrap failure so the UI can offer an accountable reset instead of
// a dead "reload to try again" message.
export class MessageIdentityLockedError extends Error {
  override name = "MessageIdentityLockedError";
}

const SEARCH_RECOVERY_GENERATION_PREFIX = "asm_msg_search_recovery_gen_";

function getStoredRecoveryGeneration(userId: string): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(
      `${SEARCH_RECOVERY_GENERATION_PREFIX}${userId}`
    );
    if (raw === null) {
      return null;
    }
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function storeRecoveryGeneration(userId: string, generation: number): void {
  try {
    window.localStorage.setItem(
      `${SEARCH_RECOVERY_GENERATION_PREFIX}${userId}`,
      String(generation)
    );
  } catch {
    // Offline search remains unavailable for this session if storage is blocked.
  }
}

interface SearchRecoveryScope {
  recoveryGeneration: number;
  userId: string;
}

interface MessageIdentityContextValue {
  error: string | null;
  identity: MessageIdentityPayload | null;
  privateKey: CryptoKey | null;
  recoveryGeneration: number | null;
  refreshRecoveryGeneration: () => Promise<number | null>;
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
  const [recoveryScope, setRecoveryScope] =
    useState<SearchRecoveryScope | null>(() => {
      if (!user) {
        return null;
      }
      const recoveryGeneration = getStoredRecoveryGeneration(user.id);
      return recoveryGeneration === null
        ? null
        : { recoveryGeneration, userId: user.id };
    });
  const [identityError, setIdentityError] = useState<string | null>(null);
  // Serializes bootstrap: `bootstrap` is recreated when the session user
  // changes, and a re-render can otherwise start a second pass that races the
  // first (two concurrent provisions mint different keypairs, and the loser
  // then cannot unlock the winner's row). One pass at a time.
  const bootstrappingRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(user?.id ?? null);
  const activeSearchScopeRef = useRef<OfflineSearchCacheScope | null>(null);
  const activeRecoveryGenerationRef = useRef<number | null>(
    user && recoveryScope?.userId === user.id
      ? recoveryScope.recoveryGeneration
      : null
  );
  const identityScopeBroadcastRef = useRef<IdentityScopeBroadcast | null>(null);
  const identitySyncInFlightRef = useRef(false);
  const activeUserId = user?.id ?? null;

  const updateRecoveryScope = useCallback(
    (nextScope: SearchRecoveryScope | null) => {
      activeRecoveryGenerationRef.current =
        nextScope?.recoveryGeneration ?? null;
      setRecoveryScope(nextScope);
    },
    []
  );

  const acceptRecoveryGeneration = useCallback(
    (nextGeneration: number) => {
      if (!user || activeUserIdRef.current !== user.id) {
        return;
      }
      const previousGeneration = activeRecoveryGenerationRef.current;
      updateRecoveryScope({
        recoveryGeneration: nextGeneration,
        userId: user.id,
      });
      storeRecoveryGeneration(user.id, nextGeneration);
      if (previousGeneration === nextGeneration) {
        return;
      }
      identityScopeBroadcastRef.current?.publish({
        phase: "generation-changed",
        recoveryGeneration: nextGeneration,
      });
      identityScopeBroadcastRef.current?.publish({
        phase: "identity-ready",
        recoveryGeneration: nextGeneration,
      });
    },
    [updateRecoveryScope, user]
  );

  useEffect(() => {
    activeUserIdRef.current = activeUserId;
  }, [activeUserId]);

  useEffect(() => {
    const nextScope =
      activeUserId && recoveryScope?.userId === activeUserId
        ? {
            recoveryGeneration: recoveryScope.recoveryGeneration,
            userId: recoveryScope.userId,
          }
        : null;
    const previousScope = activeSearchScopeRef.current;
    const scopeChanged =
      previousScope !== null &&
      (nextScope === null ||
        previousScope.userId !== nextScope.userId ||
        previousScope.recoveryGeneration !== nextScope.recoveryGeneration);
    activeSearchScopeRef.current = nextScope;
    if (scopeChanged && previousScope) {
      void offlineSearchWorkerClient.clearScope(previousScope);
      void clearLegacySearchIndexScopeForIdentity(previousScope);
    }
  }, [activeUserId, recoveryScope]);

  // Caches a verified identity private key on this device.
  const persistUnlockedKey = useCallback(
    async (
      userId: string,
      unlockedKey: CryptoKey,
      privateKeyJwk: JsonWebKey
    ) => {
      await setStoredPrivateKey(userId, privateKeyJwk);
      setPrivateKey(unlockedKey);
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
    const recoveryGeneration = activeRecoveryGenerationRef.current;
    if (recoveryGeneration !== null) {
      identityScopeBroadcastRef.current?.publish({
        phase: "identity-ready",
        recoveryGeneration,
      });
    }
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
      let unlocked: Awaited<ReturnType<typeof unlockAndMigrateIdentityBackup>>;
      try {
        unlocked = await unlockAndMigrateIdentityBackup(
          identityToUnlock,
          getStoredAccountSecret(user.id),
          {
            persist: (key, privateKeyJwk) =>
              persistUnlockedKey(user.id, key, privateKeyJwk),
            refresh: refreshIdentityBackup,
          }
        );
      } catch {
        throw new MessageIdentityLockedError(
          "This device can't read its messages key"
        );
      }
      setStatus("ready");
      if (unlocked.refreshedIdentity && activeUserIdRef.current === user.id) {
        acceptRecoveryGeneration(unlocked.refreshedIdentity.recoveryGeneration);
        setIdentity((current) =>
          current?.publicKey === identityToUnlock.publicKey &&
          current.updatedAt === identityToUnlock.updatedAt
            ? unlocked.refreshedIdentity
            : current
        );
      }
    },
    [acceptRecoveryGeneration, persistUnlockedKey, user]
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
    const storedGeneration = getStoredRecoveryGeneration(user.id);
    if (storedGeneration !== null) {
      updateRecoveryScope({
        recoveryGeneration: storedGeneration,
        userId: user.id,
      });
    }
    // A device that already unlocked keeps the private key in storage so the
    // browser does not have to re-decrypt the backup every session.
    const stored = await getStoredPrivateKey(user.id);
    if (stored) {
      const key = await importPrivateKeyJwk(stored);
      setPrivateKey(key);
      setStatus("ready");
      const refreshRecoveryGeneration = async () => {
        try {
          const data = await fetchIdentity();
          if (activeUserIdRef.current !== user.id) {
            return;
          }
          updateRecoveryScope({
            recoveryGeneration: data.recoveryGeneration,
            userId: user.id,
          });
          storeRecoveryGeneration(user.id, data.recoveryGeneration);
          if (data.identity) {
            const refreshedIdentity = await refreshLegacyIdentityBackup(
              data.identity,
              getStoredAccountSecret(user.id),
              stored,
              refreshIdentityBackup
            );
            if (refreshedIdentity) {
              acceptRecoveryGeneration(refreshedIdentity.recoveryGeneration);
            }
          }
        } catch {
          // Keep the last locally verified recovery generation for offline use.
        }
      };
      void refreshRecoveryGeneration();
      return;
    }

    const data = await fetchIdentity();
    if (activeUserIdRef.current === user.id) {
      updateRecoveryScope({
        recoveryGeneration: data.recoveryGeneration,
        userId: user.id,
      });
      storeRecoveryGeneration(user.id, data.recoveryGeneration);
    }
    if (!data.identity) {
      // No usable identity: provision one automatically.
      await enableIdentity();
      return;
    }
    setIdentity(data.identity);
    await unlockIdentity(data.identity);
  }, [
    acceptRecoveryGeneration,
    enableIdentity,
    unlockIdentity,
    updateRecoveryScope,
    user,
  ]);

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
    const { recoveryGeneration } = await resetMessageIdentity();
    updateRecoveryScope({ recoveryGeneration, userId: user.id });
    storeRecoveryGeneration(user.id, recoveryGeneration);
    identityScopeBroadcastRef.current?.publish({
      phase: "generation-changed",
      recoveryGeneration,
    });
    // Clear the cached private key and any leftover verifier-scheme secret so
    // the fresh identity starts from nothing.
    await clearStoredPrivateKey(user.id);
    setPrivateKey(null);
    setIdentity(null);
    updateRecoveryScope(null);
    setIdentityError(null);
    // Provision the replacement. bootstrap sees no local key and no server
    // identity, so it mints a fresh keypair.
    await bootstrap();
  }, [bootstrap, updateRecoveryScope, user]);

  const refreshRecoveryGeneration = useCallback(async (): Promise<
    number | null
  > => {
    if (!user) {
      return null;
    }
    try {
      const data = await fetchIdentity();
      if (activeUserIdRef.current !== user.id) {
        return null;
      }
      updateRecoveryScope({
        recoveryGeneration: data.recoveryGeneration,
        userId: user.id,
      });
      storeRecoveryGeneration(user.id, data.recoveryGeneration);
      return data.recoveryGeneration;
    } catch {
      return null;
    }
  }, [updateRecoveryScope, user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const syncedUserId = user.id;
    const broadcast = createIdentityScopeBroadcast({
      onNotice: (notice) => {
        if (activeUserIdRef.current !== syncedUserId) {
          return;
        }
        const storedGeneration = getStoredRecoveryGeneration(syncedUserId);
        if (
          storedGeneration !== null &&
          notice.recoveryGeneration < storedGeneration
        ) {
          return;
        }
        if (notice.phase === "generation-changed") {
          if (
            activeRecoveryGenerationRef.current === notice.recoveryGeneration
          ) {
            return;
          }
          updateRecoveryScope({
            recoveryGeneration: notice.recoveryGeneration,
            userId: syncedUserId,
          });
          storeRecoveryGeneration(syncedUserId, notice.recoveryGeneration);
          setPrivateKey(null);
          setIdentity(null);
          setIdentityError(null);
          setStatus("loading");
          return;
        }
        if (identitySyncInFlightRef.current) {
          return;
        }
        identitySyncInFlightRef.current = true;
        void (async () => {
          try {
            const data = await fetchIdentity();
            const canUnlock =
              activeUserIdRef.current === syncedUserId &&
              data.recoveryGeneration === notice.recoveryGeneration &&
              activeRecoveryGenerationRef.current ===
                notice.recoveryGeneration &&
              data.identity !== null;
            if (canUnlock && data.identity) {
              setIdentity(data.identity);
              await unlockIdentity(data.identity);
              if (
                activeUserIdRef.current === syncedUserId &&
                activeRecoveryGenerationRef.current ===
                  notice.recoveryGeneration
              ) {
                setIdentityError(null);
                storeRecoveryGeneration(
                  syncedUserId,
                  notice.recoveryGeneration
                );
              } else if (activeUserIdRef.current === syncedUserId) {
                setPrivateKey(null);
                setIdentity(null);
              }
            }
          } catch (error) {
            if (activeUserIdRef.current === syncedUserId) {
              setIdentityError(
                error instanceof Error
                  ? error.message
                  : "Failed to refresh message identity"
              );
              setStatus(
                error instanceof MessageIdentityLockedError ? "locked" : "error"
              );
            }
          }
          identitySyncInFlightRef.current = false;
        })();
      },
      userId: syncedUserId,
    });
    identityScopeBroadcastRef.current = broadcast;
    return () => {
      broadcast.close();
      if (identityScopeBroadcastRef.current === broadcast) {
        identityScopeBroadcastRef.current = null;
      }
    };
  }, [unlockIdentity, updateRecoveryScope, user]);

  const value = useMemo(
    () => ({
      error: identityError,
      identity,
      privateKey,
      recoveryGeneration:
        user && recoveryScope?.userId === user.id
          ? recoveryScope.recoveryGeneration
          : null,
      refreshRecoveryGeneration,
      reset,
      status,
    }),
    [
      identity,
      identityError,
      privateKey,
      recoveryScope,
      refreshRecoveryGeneration,
      reset,
      status,
      user,
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
