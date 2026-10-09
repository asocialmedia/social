import { fetch as streamingFetch } from "expo/fetch";
// The React bindings for the messages realtime streams and the polling that backs
// them up.
//
// THREE SOURCES, MATCHING WEB:
// 1. `/api/messages/conversations/:id/stream` for the open thread. Carries the
//    message rows, the read/delivered watermarks, typing and key rotations.
// 2. `/api/messages/events` for the conversation list. Only says "something
//    happened in this conversation", which is enough to refetch.
// 3. A poll on each, because a phone loses its socket in a tunnel and a backgrounded
//    app has its timers throttled. The stream is for latency; the poll is for
//    correctness.
//
// The streams pause when the app is backgrounded. On native that is not an
// optimisation: iOS suspends the app and Android throttles timers, so a socket held
// open in the background would reconnect on wake with a large gap. Pausing and
// reconciling on resume is both cheaper and more honest than pretending to be live.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  fetchConversationDetail,
  fetchConversationList,
  fetchMessages,
} from "@/features/messages/lib/client";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import type { DecryptItem } from "@/features/messages/lib/decryptor";
import { peerWatermarks } from "@/features/messages/lib/message-receipts";
import { messageReadRetryDelay } from "@/features/messages/lib/read-retry";
import {
  readMessageActivityStream,
  readMessageStream,
  shouldCatchUp,
} from "@/features/messages/lib/realtime";
import type { MessageStreamEvent } from "@/features/messages/lib/realtime";
import type { MessageData } from "@/features/messages/lib/types";
import {
  conversationListStore,
  loadUnreadCount,
} from "@/features/messages/state/conversation-list-store";
import type { ConversationListSnapshot } from "@/features/messages/state/conversation-list-store";
import {
  MESSAGE_PAGE_SIZE,
  transcriptStore,
} from "@/features/messages/state/transcript-store";
import type { TranscriptSnapshot } from "@/features/messages/state/transcript-store";
import { getApiBaseUrl } from "@/lib/api-env";

import { useMessagesIdentity } from "./message-identity";
import { useMessagesForeground } from "./use-messages-foreground";

export { type MessagePageAxis } from "@/features/messages/lib/client";
export { peerOf } from "@/features/messages/state/conversation-list-store";

// How often the transcript reconciles while the stream is believed to be live.
// Generous: the stream does the real work, this only covers a silently dead socket.
const TRANSCRIPT_POLL_MS = 60_000;
const LIST_POLL_MS = 30_000;
const UNREAD_POLL_MS = 60_000;

export interface MessagesApiContext {
  apiBase: string;
  cookie: string | null;
}

function useMessagesApiContext(): MessagesApiContext {
  const { user } = useSessionContext();
  const [cookie, setCookie] = useState<string | null>(null);
  const apiBase = getApiBaseUrl();

  // The session cookie lives in SecureStore, so it is read asynchronously and every
  // caller below waits for it rather than firing unauthenticated requests.
  useEffect(() => {
    if (!user?.id) {
      // oxlint-disable-next-line react/set-state-in-effect -- signing out has to clear the credential the pollers below are holding
      setCookie(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const value = await authClient.getCookie();
      if (!cancelled) {
        // oxlint-disable-next-line react/set-state-in-effect -- reading a stored credential is an external system; its value cannot be derived during render
        setCookie(value ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return { apiBase, cookie };
}

// ---- conversation list --------------------------------------------------------

export function useConversationList(): ConversationListSnapshot & {
  refresh: () => void;
} {
  const { user } = useSessionContext();
  const { apiBase, cookie } = useMessagesApiContext();
  const foreground = useMessagesForeground();
  const [nonce, setNonce] = useState(0);

  const snapshot = useSyncExternalStore(
    conversationListStore.subscribe,
    conversationListStore.getSnapshot,
    conversationListStore.getSnapshot
  );

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const userId = user?.id ?? null;

  // oxlint-disable-next-line react/set-state-in-effect -- the list is an external system; a poll that lands mid-render has to be written to state
  useEffect(() => {
    if (!userId || !cookie || !foreground) {
      return;
    }
    let cancelled = false;
    const options = { apiBase, baseFetch: fetch, cookie };

    const load = async () => {
      try {
        const response = await fetchConversationList(options);
        if (!cancelled) {
          conversationListStore.replaceAll(response, userId);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        // A failed poll leaves the previous rows on screen. Blanking the list on a
        // dropped request would make the app look like it lost the user's messages.
        conversationListStore.setSnapshot({
          error: error instanceof Error ? error.message : null,
          loading: false,
          refreshing: false,
        });
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, LIST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `nonce` IS the reload channel; bumping it re-runs this poll, which is why it is a dependency
  }, [apiBase, cookie, foreground, nonce, userId]);

  // The activity stream: a nudge to refetch, nothing more. This is what makes a
  // new message appear in the list without waiting out the poll.
  useEffect(() => {
    if (!userId || !cookie || !foreground) {
      return;
    }
    const controller = new AbortController();
    void readMessageActivityStream({
      baseFetch: streamingFetch,
      cookie,
      onActivity: () => {
        setNonce((value) => value + 1);
      },
      signal: controller.signal,
      url: `${apiBase}/api/messages/events`,
    });
    return () => {
      controller.abort();
    };
  }, [apiBase, cookie, foreground, userId]);

  return { ...snapshot, refresh };
}

// ---- unread badge -------------------------------------------------------------

/**
 * The nav badge count. Refcounted to one poller so the dock, the list header and
 * the profile menu do not each run their own.
 */
let unreadRefs = 0;
let unreadTimer: ReturnType<typeof setInterval> | null = null;

export function useUnreadMessageCount(): number {
  const { user } = useSessionContext();
  const { apiBase, cookie } = useMessagesApiContext();
  const [count, setCount] = useState(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || !cookie) {
      // oxlint-disable-next-line react/set-state-in-effect -- signing out has to clear the badge the nav dock is showing
      setCount(0);
      return;
    }
    // oxlint-disable-next-line react/set-state-in-effect -- the badge is the result of a poll, so it cannot be derived during render
    setCount(0);
    const options = { apiBase, baseFetch: fetch, cookie };
    const poll = async () => {
      setCount(await loadUnreadCount(options));
    };
    void poll();
    unreadRefs += 1;
    if (!unreadTimer) {
      unreadTimer = setInterval(() => {
        void poll();
      }, UNREAD_POLL_MS);
    }
    return () => {
      unreadRefs -= 1;
      if (unreadRefs <= 0 && unreadTimer) {
        clearInterval(unreadTimer);
        unreadTimer = null;
      }
    };
  }, [apiBase, cookie, userId]);

  return count;
}

// ---- transcript ---------------------------------------------------------------

export interface TranscriptBinding {
  snapshot: TranscriptSnapshot;
  /** Loads the newest page. Safe to call repeatedly. */
  loadNewest: () => void;
  loadOlder: () => void;
  /** Asks the stream for a reconcile. */
  refresh: () => void;
}

export function useTranscript(conversationId: string): TranscriptBinding {
  const { invalidateKeys } = useMessagesIdentity();
  const { user } = useSessionContext();
  const { apiBase, cookie } = useMessagesApiContext();
  const userId = user?.id ?? null;
  const foreground = useMessagesForeground();
  const [nonce, setNonce] = useState(0);
  const [reload, setReload] = useState(0);
  const newestFetching = useRef(false);
  const newestUpdatedAt = useRef(0);
  const newestRetries = useRef(0);

  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => transcriptStore.subscribe(listener),
      []
    ),
    useCallback(
      () => transcriptStore.getSnapshot(conversationId),
      [conversationId]
    ),
    useCallback(
      () => transcriptStore.getServerSnapshot(conversationId),
      [conversationId]
    )
  );

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const loadNewest = useCallback(() => {
    setReload((value) => value + 1);
  }, []);

  const loadOlder = useCallback(() => {
    if (!userId || !cookie || !foreground) {
      return;
    }
    const current = transcriptStore.getSnapshot(conversationId);
    if (current.loadingOlder || !current.hasMoreOlder) {
      return;
    }
    const oldest = current.messages.at(0);
    if (!oldest) {
      return;
    }
    transcriptStore.loadingOlder(conversationId);
    const fetchOlderPage = async () => {
      try {
        const page = await fetchMessages(
          conversationId,
          { cursor: oldest.id, kind: "older" },
          { apiBase, baseFetch: fetch, cookie },
          MESSAGE_PAGE_SIZE
        );
        transcriptStore.prependOlder(conversationId, page);
      } catch {
        // A failed page leaves what is loaded intact; the next pull retries the
        // same cursor.
        transcriptStore.setError(
          conversationId,
          "Couldn't load older messages."
        );
      }
    };
    void fetchOlderPage();
  }, [apiBase, conversationId, cookie, foreground, userId]);

  // The newest page. Reruns on `reload` (a send forced a reconcile) and on `nonce`
  // (a stream reconnect said we might have missed something).
  useEffect(() => {
    if (!userId || !cookie || !foreground) {
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    newestFetching.current = true;
    transcriptStore.setSnapshotLoading(conversationId, true);
    const fetchNewestPage = async () => {
      try {
        const page = await fetchMessages(
          conversationId,
          undefined,
          { apiBase, baseFetch: fetch, cookie },
          MESSAGE_PAGE_SIZE
        );
        if (cancelled) {
          return;
        }
        transcriptStore.setPages(conversationId, page);
        newestUpdatedAt.current = Date.now();
        // Seed the read/delivered watermarks from the detail call, so a receipt
        // drawn before the first stream event is still correct.
        const detail = await fetchConversationDetail(conversationId, {
          apiBase,
          baseFetch: fetch,
          cookie,
        });
        if (cancelled) {
          return;
        }
        transcriptStore.setPeerWatermarks(
          conversationId,
          peerWatermarks(detail.conversation.members, userId)
        );
        const mine = detail.conversation.members.find(
          (member) => member.userId === userId
        );
        transcriptStore.setMyLastReadAt(
          conversationId,
          mine?.lastReadAt ?? null
        );
        newestRetries.current = 0;
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        transcriptStore.setError(
          conversationId,
          error instanceof Error ? error.message : "Couldn't load messages."
        );
        const delay = messageReadRetryDelay(error, newestRetries.current);
        if (delay !== null) {
          newestRetries.current += 1;
          retryTimer = setTimeout(() => {
            setNonce((value) => value + 1);
          }, delay);
        }
      }
      if (!cancelled) {
        newestFetching.current = false;
      }
    };
    void fetchNewestPage();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
    // `nonce` and `reload` are the reload channel, bumped by a stream reconnect or by
    // a send that needs reconciling. The body never reads them, but the effect has to
    // re-run when they change, which is the entire reason they exist.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- see above
  }, [apiBase, conversationId, cookie, foreground, nonce, reload, userId]);

  // The per-conversation stream.
  useEffect(() => {
    if (!userId || !cookie || !foreground) {
      return;
    }
    const controller = new AbortController();
    let lastUpdatedAt = 0;

    const handleEvent = (event: MessageStreamEvent) => {
      switch (event.kind) {
        case "message.created": {
          const message = event.message as MessageData | undefined;
          if (!message?.id) {
            return;
          }
          transcriptStore.appendMessage(conversationId, message);
          if (message.senderId === userId) {
            // Our own message: the thread marks read immediately.
            transcriptStore.setPeerTyping(conversationId, false);
            return;
          }
          transcriptStore.setPeerTyping(conversationId, false);
          return;
        }
        case "message.deleted": {
          const message = event.message as MessageData | undefined;
          if (!message?.id) {
            return;
          }
          transcriptStore.applyMessageDeleted(
            conversationId,
            message.id,
            new Date()
          );
          return;
        }
        case "message.edited": {
          const message = event.message as MessageData | undefined;
          if (!message?.id) {
            return;
          }
          const previous = transcriptStore
            .getSnapshot(conversationId)
            .messages.find((row) => row.id === message.id);
          transcriptStore.applyMessageEdit(conversationId, message);
          // The ciphertext changed but the ratchet index did not, so the cached
          // plaintext is stale. Without this the bubble keeps showing the old text
          // until the row is scrolled away and back.
          if (previous && previous.ciphertext !== message.ciphertext) {
            messageDecryptor.invalidate(message.id);
          }
          return;
        }
        case "conversation.read": {
          transcriptStore.advancePeerWatermark(conversationId, {
            readAt: event.readAt ?? null,
          });
          return;
        }
        case "conversation.delivered": {
          transcriptStore.advancePeerWatermark(conversationId, {
            deliveredAt: event.deliveredAt ?? null,
          });
          return;
        }
        case "typing.started": {
          if (event.userId === userId) {
            return;
          }
          transcriptStore.setPeerTyping(conversationId, true);
          return;
        }
        case "keys.rotated": {
          // A rotation invalidates every cached root for this conversation, so the
          // next fetch resolves the newest wraps rather than reading superseded ones.
          invalidateKeys(conversationId);
          messageDecryptor.clearKeys(conversationId);
          messageDecryptor.clearErrors(conversationId);
          setNonce((value) => value + 1);
          break;
        }
        default: {
          break;
        }
      }
    };

    void readMessageStream({
      baseFetch: streamingFetch,
      cookie,
      onConnect: (isReconnect) => {
        // A reconnect may have missed anything at all: the stream has no replay
        // cursor. The initial connect only reconciles a cold or stale cache.
        if (
          shouldCatchUp({
            dataUpdatedAt: Math.max(lastUpdatedAt, newestUpdatedAt.current),
            isFetching: newestFetching.current,
            isReconnect,
            now: Date.now(),
          })
        ) {
          setNonce((value) => value + 1);
        }
      },
      onEvent: (event) => {
        lastUpdatedAt = Date.now();
        handleEvent(event);
      },
      onUnauthorized: () => {
        void authClient.signOut();
      },
      signal: controller.signal,
      url: `${apiBase}/api/messages/conversations/${conversationId}/stream`,
    });

    // The correctness backstop behind the stream.
    const poll = setInterval(() => {
      setNonce((value) => value + 1);
    }, TRANSCRIPT_POLL_MS);

    return () => {
      clearInterval(poll);
      controller.abort();
    };
  }, [apiBase, conversationId, cookie, foreground, invalidateKeys, userId]);

  return { loadNewest, loadOlder, refresh, snapshot };
}

// Requests the decrypt items for a set of visible rows and returns the decrypted
// payloads for them. Subscribed to the decryptor rather than polled, so a row fills
// in the instant its plaintext lands.
export function useDecryptedRows(
  items: DecryptItem[],
  getBaseKeys: (conversationId: string) => Promise<Uint8Array[]>
): ReadonlyMap<string, ReturnType<typeof messageDecryptor.get>> {
  useEffect(() => {
    if (items.length > 0) {
      messageDecryptor.request(items, { getBaseKeys });
    }
  }, [getBaseKeys, items]);

  // The version counter is the notification channel: the decryptor bumps it on
  // every flush, and this re-renders the consumer.
  const version = useSyncExternalStore(
    messageDecryptor.subscribe,
    messageDecryptor.getVersion,
    messageDecryptor.getVersion
  );
  const result = new Map<string, ReturnType<typeof messageDecryptor.get>>();
  if (version >= 0) {
    for (const item of items) {
      result.set(item.message.id, messageDecryptor.get(item.message.id));
    }
  }
  return result;
}
