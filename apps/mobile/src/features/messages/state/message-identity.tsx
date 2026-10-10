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
//    The bootstrap tries the stored secret and compares its hash to the row,
//    so those rows are not stranded. No user-facing secret is introduced.
// 3. A LOST KEY DEGRADES, IT NEVER BRICKS. `reset` calls the server route that
//    drops this account's identity and its own wraps, so the peer's older epochs
//    stay readable and the peer's history survives.
//
// Release builds derive the backup key on a native background queue. Expo Go
// yields between JS rounds, so automatic recovery never monopolizes touches.

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { resetMessageIdentity } from "@/features/messages/lib/client";
import { createConversationKeySource } from "@/features/messages/lib/conversation-key-source";
import {
  clearStoredPrivateKey,
  setMessageKeyStore,
} from "@/features/messages/lib/crypto";
import type { EcdhPrivateKey } from "@/features/messages/lib/crypto-primitives";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import { bootstrapMessageIdentity } from "@/features/messages/lib/identity-bootstrap";
import { messageReadRetryDelay } from "@/features/messages/lib/read-retry";
import { secureMessageKeyStore } from "@/features/messages/lib/secure-key-store";
import { getApiBaseUrl } from "@/lib/api-env";

import { configureNativeMessageCrypto } from "./native-message-crypto";

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
  mediaCookie: string | null;
  getBaseKeys: (conversationId: string) => Promise<Uint8Array[]>;
  invalidateKeys: (conversationId: string) => void;
  reset: () => Promise<void>;
  retry: () => void;
}

const EMPTY_DATA: IdentityData = {
  error: null,
  identity: null,
  privateKey: null,
  status: "loading",
  userId: null,
};

// Signing out, or arriving with no session: nothing to reset.
const NO_KEYS = () => Promise.resolve<Uint8Array[]>([]);

const NO_RESET: () => Promise<void> = () => Promise.resolve();

const MessagesIdentityContext = createContext<MessagesIdentityValue>({
  ...EMPTY_DATA,
  getBaseKeys: NO_KEYS,
  invalidateKeys: () => {
    // No identity is mounted yet.
  },
  mediaCookie: null,
  reset: NO_RESET,
  retry: () => {
    // No provider is mounted to retry yet.
  },
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

const GENERIC_FAILURE = "Couldn't connect to Messages. Please try again.";
const LOCKED_COPY =
  "Your message key can't be read on this device. Start over to create a new one. Your conversation history before this point stays readable to the other person.";

export function MessagesIdentityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useSessionContext();
  const userId = user?.id ?? null;
  const [data, setData] = useState<IdentityData>(EMPTY_DATA);
  const [revision, setRevision] = useState(0);
  const [mediaAuth, setMediaAuth] = useState<{
    cookie: string;
    userId: string;
  } | null>(null);

  // Register the SecureStore binding before anything can ask for a key.
  useEffect(() => {
    setMessageKeyStore(secureMessageKeyStore);
  }, []);

  const retry = useCallback(() => {
    setData({ ...EMPTY_DATA, userId });
    setRevision((value) => value + 1);
  }, [userId]);

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
    setRevision((value) => value + 1);
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
    let cancelled = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        // Entropy first: on Hermes there is no global crypto at all, so a keypair
        // generated before this would throw.
        await configureNativeMessageCrypto();
        const cookie = await authClient.getCookie();
        if (!cancelled) {
          setMediaAuth({ cookie: cookie ?? "", userId });
        }
        const options = { apiBase: getApiBaseUrl(), cookie };
        const resolved = await bootstrapMessageIdentity(userId, options);
        if (cancelled) {
          return;
        }
        if (resolved.status === "ready" && resolved.privateKey) {
          publishReady(resolved.identity.publicKey, resolved.privateKey);
        } else {
          setData({ ...resolved, error: LOCKED_COPY, userId });
        }
      } catch (error) {
        if (!cancelled) {
          setData({
            error: GENERIC_FAILURE,
            identity: null,
            privateKey: null,
            status: "error",
            userId,
          });
          const delay = messageReadRetryDelay(error, retries);
          if (delay !== null) {
            retries += 1;
            retryTimer = setTimeout(() => {
              void load();
            }, delay);
          }
        }
      }
    };
    void load();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- revision starts a fresh bootstrap after an explicit identity reset
  }, [publishReady, revision, userId]);

  const keySource = useMemo(() => {
    if (data.userId !== userId || !userId || !data.privateKey) {
      return {
        getBaseKeys: NO_KEYS,
        invalidate: () => {
          // Keys will be resolved after identity recovery.
        },
      };
    }
    return createConversationKeySource(data.privateKey, userId, async () => ({
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    }));
  }, [data.privateKey, data.userId, userId]);

  const value: MessagesIdentityValue = useMemo(
    () => ({
      ...(data.userId === userId ? data : { ...EMPTY_DATA, userId }),
      getBaseKeys: keySource.getBaseKeys,
      invalidateKeys: keySource.invalidate,
      mediaCookie: mediaAuth?.userId === userId ? mediaAuth.cookie : null,
      reset: userId ? reset : NO_RESET,
      retry,
    }),
    [data, keySource, mediaAuth, reset, retry, userId]
  );

  return (
    <MessagesIdentityContext value={value}>{children}</MessagesIdentityContext>
  );
}
