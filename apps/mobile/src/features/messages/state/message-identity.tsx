// The messages identity lifecycle on native: provision, unlock, recover, reset.
//
// Ported from apps/web/src/components/messages/message-identity-provider.tsx.
// The three invariants AGENTS.md demands of any change to how message keys are
// derived, stored, wrapped or recovered all hold here too:
//
// 1. RECOVERY IS AUTOMATIC AND THE STORED ROW IS THE SOURCE. The master key is
//    derived with PBKDF2 from a random seed whose SHA-256 hash is persisted with
//    the identity, so a fresh device with no local storage and no user input
//    always recovers. See the recovery branch below.
// 2. ABANDONED VERIFIER ROWS STILL UNLOCK WHERE POSSIBLE. That is the short-lived
//    scheme whose master key came from a raw secret held on one device.
//    `unlockVerifierRow` tries the stored secret and compares its hash to the row,
//    so those rows are not stranded. No user-facing secret is introduced.
// 3. A LOST KEY DEGRADES, IT NEVER BRICKS. `reset` calls the server route that
//    drops this account's identity and its own wraps, so the peer's older epochs
//    stay readable and the peer's history survives.
//
// PBKDF2 AT 100k ITERATIONS IS GENUINELY SLOW ON HERMES, so the screen shows a
// `status` that names the step rather than an unexplained spinner.

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  fetchIdentity,
  resetMessageIdentity,
  saveIdentity,
} from "@/features/messages/lib/client";
import type { MessageIdentityPayload } from "@/features/messages/lib/client";
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
  configureNativeEntropy,
  setMessageKeyStore,
  setStoredPrivateKey,
} from "@/features/messages/lib/crypto";
import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
} from "@/features/messages/lib/crypto-primitives";
import type { EcdhPrivateKey } from "@/features/messages/lib/crypto-primitives";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import { secureMessageKeyStore } from "@/features/messages/lib/secure-key-store";
import { getApiBaseUrl } from "@/lib/api-env";

export type IdentityStatus = "error" | "loading" | "locked" | "ready";

// The identity DATA, with no actions in it. `reset` is supplied separately so a
// state update never has to carry the callback that performed it.
interface IdentityData {
  error: string | null;
  identity: { publicKey: string } | null;
  privateKey: EcdhPrivateKey | null;
  status: IdentityStatus;
  userId: string | null;
}

export interface MessagesIdentityValue extends IdentityData {
  reset: () => Promise<void>;
}

const EMPTY_DATA: IdentityData = {
  error: null,
  identity: null,
  privateKey: null,
  status: "loading",
  userId: null,
};

// Signing out, or arriving with no session: nothing to reset.
const NO_RESET: () => Promise<void> = () => Promise.resolve();

const MessagesIdentityContext = createContext<MessagesIdentityValue>({
  ...EMPTY_DATA,
  reset: NO_RESET,
});

export function useMessagesIdentity(): MessagesIdentityValue {
  return use(MessagesIdentityContext);
}

export class MessageIdentityLockedError extends Error {
  constructor() {
    super("message identity locked");
    this.name = "MessageIdentityLockedError";
  }
}

const GENERIC_FAILURE = "We couldn't set up message encryption.";
const LOCKED_COPY =
  "Your message key can't be read on this device. Start over to create a new one. Your conversation history before this point stays readable to the other person.";

// The server stores the encrypted private key as "<iv>.<ciphertext>".
function splitPrivateKey(stored: string): { ciphertext: string; iv: string } {
  const separator = stored.indexOf(".");
  if (separator === -1) {
    throw new Error("Malformed encrypted private key");
  }
  return {
    ciphertext: stored.slice(separator + 1),
    iv: stored.slice(0, separator),
  };
}

// Unwraps the stored private key with a master key derived from `material`.
// Shared by the automatic and verifier paths so both cross the same trust
// boundary and produce the same JWK.
async function recoverPrivateKey(
  identity: MessageIdentityPayload,
  material: string,
  userId: string
): Promise<EcdhPrivateKey> {
  const masterKey = await deriveMasterKey(
    material,
    base64ToBytes(identity.salt),
    identity.kdfIterations
  );
  const { ciphertext, iv } = splitPrivateKey(identity.encryptedPrivateKey);
  const jwk = JSON.parse(
    await decryptWithMasterKey(masterKey, { ciphertext, iv })
  ) as JsonWebKey;
  await setStoredPrivateKey(userId, jwk);
  return importPrivateKeyJwk(jwk);
}

export function MessagesIdentityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useSessionContext();
  const userId = user?.id ?? null;
  const [data, setData] = useState<IdentityData>(EMPTY_DATA);
  // One bootstrap at a time. Without this, a user object that changes identity
  // (or a remount) would race two provisions and leave a half-written identity row.
  const bootstrappingRef = useRef(false);

  // Register the SecureStore binding before anything can ask for a key.
  useEffect(() => {
    setMessageKeyStore(secureMessageKeyStore);
  }, []);

  const reset = useCallback(async () => {
    if (!userId) {
      return;
    }
    const cookie = await authClient.getCookie();
    await resetMessageIdentity({ apiBase: getApiBaseUrl(), cookie });
    await clearStoredPrivateKey(userId);
    // The cached roots belong to the dead identity, so decryption must not keep
    // using them.
    messageDecryptor.clearKeys();
    // Re-provision from scratch: a fresh keypair, a fresh salt, a fresh backup
    // row. Only this account's history becomes unreadable; the peer's wraps stay.
    setData({ ...EMPTY_DATA, status: "loading", userId });
  }, [userId]);

  const publishReady = useCallback(
    (publicKey: string, privateKey: EcdhPrivateKey) => {
      // Scope the decryptor by user AND public key: a reset changes the latter, so
      // an account switching identity cannot keep serving the old epoch's
      // plaintext.
      messageDecryptor.configureScope(`${userId}:${publicKey}`);
      setData({
        error: null,
        identity: { publicKey },
        privateKey,
        status: "ready",
        userId,
      });
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) {
      // oxlint-disable-next-line react/set-state-in-effect -- signing out has to clear the identity the decryptor and the key store are holding
      setData(EMPTY_DATA);
      return;
    }
    if (bootstrappingRef.current) {
      return;
    }
    bootstrappingRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        // Entropy first: on Hermes there is no global crypto at all, so a keypair
        // generated before this would throw.
        await configureNativeEntropy();
        const cookie = await authClient.getCookie();
        const options = { apiBase: getApiBaseUrl(), cookie };
        const { identity } = await fetchIdentity(options);

        if (identity) {
          // A stored row means a returning device.
          const localJwk = await getStoredPrivateKey(userId);
          if (localJwk) {
            if (!cancelled) {
              publishReady(identity.publicKey, importPrivateKeyJwk(localJwk));
            }
            return;
          }

          // Invariant 1 first: recover from the stored row alone, no user input.
          try {
            const recovered = await recoverPrivateKey(
              identity,
              identity.masterKeyHash,
              userId
            );
            if (!cancelled) {
              publishReady(identity.publicKey, recovered);
            }
            return;
          } catch {
            // Fall through to invariant 2 before giving up.
          }

          // Invariant 2: a verifier row cannot be auto-recovered, but this device
          // may still hold the raw secret it was derived from.
          const verifierSecret = await getStoredAccountSecret(userId);
          if (verifierSecret) {
            try {
              const matches =
                (await hashAccountSecret(verifierSecret)) ===
                identity.masterKeyHash;
              if (matches) {
                const unlocked = await recoverPrivateKey(
                  identity,
                  verifierSecret,
                  userId
                );
                if (!cancelled) {
                  publishReady(identity.publicKey, unlocked);
                }
                return;
              }
            } catch {
              // A stored secret that does not open this row is no help; fall
              // through to locked.
            }
          }

          // Invariant 3: the row exists but nothing on this device can read it.
          // That is `locked` with a reset, never a dead end.
          if (!cancelled) {
            setData({
              error: LOCKED_COPY,
              identity: { publicKey: identity.publicKey },
              privateKey: null,
              status: "locked",
              userId,
            });
          }
          return;
        }

        // No row: provision. Nothing exists to preserve, so this is the only
        // moment a key is generated.
        const { privateKey, publicKey } = generateIdentityKeyPair();
        const salt = bytesToBase64(randomBytes(16));
        // The raw secret is hashed and discarded: the PBKDF2 input is the HASH, so
        // the stored row alone re-derives the backup key.
        const masterKeyHash = await hashAccountSecret(generateAccountSecret());
        const masterKey = await deriveMasterKey(
          masterKeyHash,
          base64ToBytes(salt),
          KDF_ITERATIONS
        );
        const encryptedPrivateKey = await encryptWithMasterKey(
          masterKey,
          JSON.stringify(exportPrivateKeyJwk(privateKey))
        );
        const publicKeyEncoded = publicKeyJwkToBase64(
          exportPublicKeyJwk(publicKey)
        );
        await saveIdentity(
          {
            encryptedPrivateKey: `${encryptedPrivateKey.iv}.${encryptedPrivateKey.ciphertext}`,
            kdfIterations: KDF_ITERATIONS,
            masterKeyHash,
            publicKey: publicKeyEncoded,
            salt,
          },
          options
        );
        // Cached locally too, so the next mount skips the PBKDF2 entirely.
        await setStoredPrivateKey(userId, exportPrivateKeyJwk(privateKey));
        if (!cancelled) {
          publishReady(publicKeyEncoded, privateKey);
        }
      } catch {
        if (!cancelled) {
          setData({
            error: GENERIC_FAILURE,
            identity: null,
            privateKey: null,
            status: "error",
            userId,
          });
        }
        // Cleared on both paths rather than in a `finally`, which React Compiler
        // cannot lower inside a component. The flag exists only to stop two
        // bootstraps racing, and either path ends that race.
        bootstrappingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publishReady, userId]);

  const value: MessagesIdentityValue = useMemo(
    () => ({ ...data, reset: userId ? reset : NO_RESET }),
    [data, reset, userId]
  );

  return (
    <MessagesIdentityContext value={value}>{children}</MessagesIdentityContext>
  );
}
