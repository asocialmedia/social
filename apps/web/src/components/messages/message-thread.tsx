"use client";

import type { MessageData, MessagePage } from "@asm/db";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowLeft,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import { MessageBubble } from "@/components/messages/message-bubble";
import { MessageComposer } from "@/components/messages/message-composer";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { MessageThreadSkeleton } from "@/components/messages/messages-skeleton";
import {
  appendMessageToLastPage,
  fetchConversationDetail,
  fetchMessages,
  markConversationRead,
} from "@/lib/messages/client";
import type { ConversationDetailResponse } from "@/lib/messages/client";
import type { MessagePayload } from "@/lib/messages/crypto";
import {
  exportPublicKeyJwk,
  generateFingerprint,
  importPublicKeyJwk,
  importRatchetBaseKey,
  publicKeyBase64ToJwk,
} from "@/lib/messages/crypto";
import type { DecryptEntry, DecryptItem } from "@/lib/messages/decryptor";
import { messageDecryptor } from "@/lib/messages/decryptor";
import {
  formatArrivalCount,
  isNearBottom,
  nextArrivalCount,
  PINNED_THRESHOLD_PX,
} from "@/lib/messages/scroll-state";
import { useDecryptEntry } from "@/lib/messages/use-decrypt-entry";
import {
  findMyWrappedKey,
  findPeerPublicKey,
  useRootKeyStore,
} from "@/lib/messages/use-decryption";
import {
  useMessagesRealtime,
  shouldCatchUp,
} from "@/lib/messages/use-messages-realtime";
import { usePresence } from "@/lib/messages/use-presence";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  conversationId: string;
  onBack: () => void;
  onToggleRail: () => void;
}

// Estimated row height before measurement. Close to a one-line bubble so the
// scrollbar is roughly right on first paint; measureElement corrects each
// row after mount and on decrypt/image-load resizes.
const ESTIMATED_ROW_SIZE = 80;
// The decrypt window extends this many rows beyond the viewport each way;
// history outside it is not requested until scrolled near.
const DECRYPT_PREFETCH_ROWS = 64;

export function MessageThread({
  conversationId,
  onBack,
  onToggleRail,
}: MessageThreadProps) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const queryClient = useQueryClient();
  const rootKeyStore = useRootKeyStore();
  const onlineUsers = usePresence(true);

  const [replyTarget, setReplyTarget] = useState<{
    content?: string;
    id: string;
    senderId: string;
    senderName?: string;
  } | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  // Whether the viewport is pinned to the newest message, and how many peer
  // messages have arrived since it last was (the Telegram-style badge).
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [arrivalCount, setArrivalCount] = useState(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `pinnedToBottom` for reads inside event callbacks without stale
  // closures. Kept in sync in one place (the scroll listener) so the two can
  // never disagree.
  const pinnedRef = useRef(true);

  const { data: detail } = useQuery({
    queryFn: () => fetchConversationDetail(conversationId),
    queryKey: ["message-conversation", conversationId],
    // Keys/membership are stable for a thread's lifetime; the composer
    // invalidates this explicitly after it posts new wrapped keys.
    staleTime: 5 * 60 * 1000,
  });

  const messagesQuery = useInfiniteQuery<
    MessagePage,
    Error,
    InfiniteData<MessagePage, string | undefined>,
    readonly [string, string],
    string | undefined
  >({
    // Newer messages arrive over the SSE stream; there is no next page.
    // oxlint-disable-next-line unicorn/no-useless-undefined -- sentinel for "no more pages"
    getNextPageParam: () => undefined,
    getPreviousPageParam: (lastPage) => lastPage.previousCursor,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMessages(conversationId, pageParam),
    queryKey: ["messages", conversationId] as const,
    // Live updates come from the SSE stream, which folds creates/deletes
    // straight into this cache. Mount/focus/reconnect refetches therefore add
    // nothing but races: overlapping responses can land out of order and
    // replace freshly folded pages with a stale snapshot, which is exactly
    // what made the transcript differ on every open. Keep a short freshness
    // window so genuine remounts reuse the cache, and let the guarded
    // reconnect catch-up handle real gaps.
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const allMessages = useMemo(
    () => (messagesQuery.data?.pages ?? []).flatMap((page) => page.messages),
    [messagesQuery.data]
  );

  // Resolve a replyToId to its parent without scanning the whole list for
  // every rendered bubble.
  const messagesById = useMemo(
    () => new Map(allMessages.map((message) => [message.id, message])),
    [allMessages]
  );
  // Bumped only when a PREVIOUS page is prepended (pages.length grows). An
  // appended message can never introduce a reply parent (parents are older),
  // so rows can skip re-rendering on append but must re-render on prepend to
  // resolve a parent that just became available. See the row memo comparator.
  const historyVersion = messagesQuery.data?.pages.length ?? 0;

  const peer = detail?.conversation.members.find(
    (member) => member.userId !== user?.id
  )?.user;
  const peerPresence = peer
    ? (onlineUsers.find((u) => u.id === peer.id)?.status ?? null)
    : null;

  const userId = user?.id;

  const handleReply = useCallback(
    (message: MessageData) => {
      // Read at click time so the quote always reflects the latest payload.
      const payload = messageDecryptor.get(message.id);
      setReplyTarget({
        content: replyPreview(payload),
        id: message.id,
        senderId: message.senderId,
        senderName:
          message.senderId === userId
            ? "You"
            : (message.sender?.displayName ?? peer?.displayName ?? "them"),
      });
    },
    [peer?.displayName, userId]
  );

  // The decryptor cache is scoped to this identity so a logout/login never
  // serves another account's plaintext.
  useEffect(() => {
    messageDecryptor.configureScope(userId ?? "anonymous");
  }, [userId]);

  // Turns one wire message into a decrypt request item. Stable helper so the
  // request effect and row-level parent fetches share the exact shape.
  const toDecryptItem = useCallback(
    (message: MessageData): DecryptItem => ({
      conversationId,
      message: {
        ciphertext: message.ciphertext,
        id: message.id,
        iv: message.iv,
        ratchetIndex: message.ratchetIndex,
        senderId: message.senderId,
      },
    }),
    [conversationId]
  );

  // Resolves (via the decryptor's per-conversation cache) the imported
  // ratchet base key every queued message in this thread funnels through.
  const getBaseKey = useCallback(
    async (targetConversationId: string): Promise<CryptoKey | null> => {
      if (
        !detail ||
        !rootKeyStore ||
        !userId ||
        targetConversationId !== conversationId
      ) {
        return null;
      }
      const wrapped = findMyWrappedKey(detail.keys, userId);
      const peerPublicKey = findPeerPublicKey(detail.conversation, userId);
      if (!wrapped || !peerPublicKey) {
        return null;
      }
      try {
        const rootKey = await rootKeyStore.getRootKey(
          conversationId,
          wrapped,
          peerPublicKey
        );
        return await importRatchetBaseKey(rootKey);
      } catch {
        return null;
      }
    },
    [conversationId, detail, rootKeyStore, userId]
  );

  // oxlint-disable-next-line react/incompatible-library -- useVirtualizer returns unmemoizable measuring/scroll handles by design (upstream chat recipe); rows stay memoized on their own props
  const rowVirtualizer = useVirtualizer({
    anchorTo: "end",
    count: allMessages.length,
    estimateSize: () => ESTIMATED_ROW_SIZE,
    followOnAppend: true,
    getItemKey: useCallback(
      (index: number) => allMessages[index]?.id ?? `index-${index}`,
      [allMessages]
    ),
    getScrollElement: () => scrollRef.current,
    overscan: 8,
    paddingEnd: 8,
    paddingStart: 16,
    // Same threshold the pinned tracker uses, so "follow new messages" and
    // "show the jump badge" flip at exactly the same scroll position.
    scrollEndThreshold: PINNED_THRESHOLD_PX,
    useFlushSync: false,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualRangeKey = (() => {
    const lastItem = virtualItems.at(-1);
    return virtualItems.length > 0 && lastItem
      ? `${virtualItems[0].index}:${lastItem.index}`
      : "empty";
  })();

  // Queue decrypts for the visible window plus a prefetch margin, visible
  // rows first. History outside the window is never requested until scrolled
  // near, and deleted rows need no payload at all. Reply parents are fetched
  // by the row that quotes them (see VirtualRow), so this effect does not
  // depend on decrypt results and never re-runs on a completion batch.
  useEffect(() => {
    if (!detail || !rootKeyStore || !userId || allMessages.length === 0) {
      return;
    }
    const [first, last] = (() => {
      const items = rowVirtualizer.getVirtualItems();
      const lastItem = items.at(-1);
      if (items.length === 0 || !lastItem) {
        return [allMessages.length - 1, allMessages.length - 1] as const;
      }
      return [items[0].index, lastItem.index] as const;
    })();
    const start = Math.max(0, first - DECRYPT_PREFETCH_ROWS);
    const end = Math.min(allMessages.length - 1, last + DECRYPT_PREFETCH_ROWS);
    const items: DecryptItem[] = [];
    const seen = new Set<string>();
    const push = (message: MessageData | undefined) => {
      if (!message || message.deletedAt || seen.has(message.id)) {
        return;
      }
      seen.add(message.id);
      items.push(toDecryptItem(message));
    };
    for (let index = first; index <= last; index += 1) {
      push(allMessages[index]);
    }
    for (let index = first - 1; index >= start; index -= 1) {
      push(allMessages[index]);
    }
    for (let index = last + 1; index <= end; index += 1) {
      push(allMessages[index]);
    }
    messageDecryptor.request(items, { getBaseKey });
    // virtualRangeKey re-runs this on scroll; request() itself is a cheap
    // skip for cached, queued, and in-flight ids.
  }, [
    allMessages,
    conversationId,
    detail,
    getBaseKey,
    rootKeyStore,
    toDecryptItem,
    userId,
    virtualRangeKey,
    rowVirtualizer,
  ]);

  // Row-level request helper: a row asks for its own payload (self-heal) or a
  // quoted parent's. request() is idempotent and cheap for cached/queued/
  // in-flight ids, so over-calling is harmless.
  const requestDecrypt = useCallback(
    (message: MessageData | undefined) => {
      if (!message) {
        return;
      }
      messageDecryptor.request([toDecryptItem(message)], { getBaseKey });
    },
    [getBaseKey, toDecryptItem]
  );

  // Healed keys (re-provisioned identity, first wrapped-key post) must retry
  // payloads that previously failed. Dropping the errors makes both the
  // request effect and each row's self-heal re-queue them.
  useEffect(() => {
    if (!detail || !rootKeyStore || !userId) {
      return;
    }
    messageDecryptor.clearErrors();
  }, [detail, rootKeyStore, userId]);

  // Start pinned to the latest message. The scroll element only exists once
  // `detail` resolves (before that the skeleton renders), so this must key on
  // detail and run exactly once — not on every detail refetch.
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (!detail || didInitialScrollRef.current) {
      return;
    }
    didInitialScrollRef.current = true;
    rowVirtualizer.scrollToEnd();
  }, [detail, rowVirtualizer]);

  // The landing above runs the moment `detail` resolves, when the first page
  // of messages is usually still in flight — so it scrolls an empty list and
  // the transcript then renders from the top. Re-pin once the first real
  // content exists so opening or refreshing a thread always shows the newest
  // message, regardless of which query settled first. The extra rAF re-pins
  // after the first measurement pass corrects the estimated row heights,
  // which otherwise leaves the view a little short of the true end.
  const hasLandedRef = useRef(false);
  useLayoutEffect(() => {
    if (hasLandedRef.current || allMessages.length === 0 || !detail) {
      return;
    }
    hasLandedRef.current = true;
    rowVirtualizer.scrollToEnd();
    const frame = requestAnimationFrame(() => {
      rowVirtualizer.scrollToEnd();
    });
    return () => cancelAnimationFrame(frame);
  }, [allMessages.length, detail, rowVirtualizer]);

  // Track the pinned state from actual scroll position. Passive listener with
  // change-gated state writes, so scrolling never triggers a render storm.
  // Becoming pinned clears the arrival badge (the user has caught up).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const pinned = isNearBottom(el);
      if (pinned === pinnedRef.current) {
        return;
      }
      pinnedRef.current = pinned;
      setPinnedToBottom(pinned);
      if (pinned) {
        setArrivalCount(0);
      }
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    return () => el.removeEventListener("scroll", measure);
  }, [detail]);

  // Pull older history as the top of the loaded window nears the first
  // virtual row. Stable keys keep the viewport anchored on prepend.
  const { fetchPreviousPage, hasPreviousPage, isFetchingPreviousPage } =
    messagesQuery;
  useEffect(() => {
    if (
      virtualItems.length > 0 &&
      virtualItems[0].index < 4 &&
      hasPreviousPage &&
      !isFetchingPreviousPage
    ) {
      void fetchPreviousPage();
    }
  }, [
    fetchPreviousPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    virtualItems,
  ]);

  const retryDecrypt = useCallback(
    (message: MessageData) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      messageDecryptor.retry(message.id);
      requestDecrypt(message);
    },
    [detail, requestDecrypt, rootKeyStore, userId]
  );

  // Jump to the newest message and clear the badge. Optimistically marks the
  // viewport pinned so followOnAppend resumes tracking immediately, without
  // waiting for the smooth scroll to settle and fire a scroll event.
  const jumpToBottom = useCallback(() => {
    pinnedRef.current = true;
    setPinnedToBottom(true);
    setArrivalCount(0);
    rowVirtualizer.scrollToEnd({ behavior: "smooth" });
  }, [rowVirtualizer]);

  // Mark the conversation read when it opens and when the peer sends while
  // the thread is open (debounced so burst sends only fire one request).
  const myUserId = user?.id;
  const scheduleRead = useCallback(() => {
    if (readDebounceRef.current) {
      clearTimeout(readDebounceRef.current);
    }
    readDebounceRef.current = setTimeout(async () => {
      try {
        await markConversationRead(conversationId);
        void queryClient.invalidateQueries({
          queryKey: ["unread-message-count"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["message-conversations", myUserId],
        });
      } catch {
        // Best-effort read marking; the next open, send, or peer message
        // re-runs it, so a failed request must not become an unhandled
        // rejection.
      }
    }, 800);
  }, [conversationId, myUserId, queryClient]);

  useEffect(() => {
    scheduleRead();
    return () => {
      if (readDebounceRef.current) {
        clearTimeout(readDebounceRef.current);
      }
    };
    // scheduleRead already closes over conversationId, so its identity change
    // covers every conversation switch without listing conversationId here.
  }, [scheduleRead]);

  const handleEvent = useCallback(
    (event: {
      conversationId: string;
      kind:
        | "message.created"
        | "message.deleted"
        | "conversation.read"
        | "typing.started";
      message?: MessageData;
      userId?: string;
    }) => {
      // The peer is typing: show it briefly. The sender's own echo is ignored.
      if (event.kind === "typing.started") {
        if (event.userId && event.userId !== user?.id) {
          setPeerTyping(true);
          if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current);
          }
          typingTimerRef.current = setTimeout(() => {
            setPeerTyping(false);
          }, 4000);
        }
        return;
      }

      const { message } = event;
      if (!message) {
        return;
      }
      if (event.kind === "message.created") {
        queryClient.setQueryData<InfiniteData<MessagePage, string | undefined>>(
          ["messages", conversationId] as const,
          (old) => {
            if (!old) {
              return old;
            }
            // Dedupe against the sender's own optimistic fold of the same
            // message (the SSE stream echoes every write, including ours).
            const nextPages = appendMessageToLastPage(old.pages, message);
            return nextPages ? { ...old, pages: nextPages } : old;
          }
        );
        // A message from the peer while we're looking at the thread counts as
        // read immediately and means they stopped typing.
        if (message.senderId !== user?.id) {
          setPeerTyping(false);
          scheduleRead();
          // Scrolled away from the bottom: surface how many arrived instead
          // of yanking the viewport (Telegram behavior).
          setArrivalCount((current) =>
            nextArrivalCount(current, {
              isOwn: false,
              pinned: pinnedRef.current,
            })
          );
        }
      } else if (event.kind === "message.deleted") {
        queryClient.setQueryData<InfiniteData<MessagePage, string | undefined>>(
          ["messages", conversationId] as const,
          (old) => {
            if (!old) {
              return old;
            }
            const pages = old.pages.map((page) => ({
              ...page,
              messages: page.messages.map((m) =>
                m.id === message.id ? { ...m, deletedAt: new Date() } : m
              ),
            }));
            return { ...old, pages };
          }
        );
      }
    },
    [conversationId, queryClient, scheduleRead, user?.id]
  );

  useMessagesRealtime(
    conversationId,
    handleEvent,
    Boolean(user),
    // Catch up on messages published while the stream was down (mobile
    // network drops). Guarded so a reconnect never stacks a refetch on top of
    // an in-flight one or on top of freshly written data — overlapping
    // responses can land out of order and leave a stale page on screen.
    useCallback(() => {
      const state = queryClient.getQueryState(["messages", conversationId]);
      if (
        !shouldCatchUp({
          dataUpdatedAt: state?.dataUpdatedAt ?? 0,
          isFetching: state?.fetchStatus === "fetching",
          now: Date.now(),
        })
      ) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: ["messages", conversationId],
      });
    }, [conversationId, queryClient])
  );

  // Clear the typing timer when the thread unmounts.
  useEffect(
    () => () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    },
    []
  );

  if (!detail) {
    return <MessageThreadSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ThreadHeader
        conversation={detail}
        onBack={onBack}
        onToggleRail={onToggleRail}
        peer={peer}
        peerPresence={peerPresence}
        peerTyping={peerTyping}
        privateKey={privateKey}
      />

      <div className="relative min-h-0 flex-1">
        <div
          className="hide-native-scrollbar h-full overflow-y-auto"
          ref={scrollRef}
        >
          {allMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="px-6 py-5">
                <p className="text-muted-foreground text-sm">
                  Say hi to {peer?.displayName ?? "them"}
                </p>
                <p className="text-muted-foreground/70 mt-1 text-xs">
                  Messages here are end-to-end encrypted.
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualItems.map((virtualItem) => {
                const message = allMessages[virtualItem.index];
                if (!message) {
                  return null;
                }
                return (
                  <div
                    data-index={virtualItem.index}
                    key={virtualItem.key}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      left: 0,
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${virtualItem.start}px)`,
                      width: "100%",
                    }}
                  >
                    <VirtualRow
                      historyVersion={historyVersion}
                      message={message}
                      messagesById={messagesById}
                      myUserId={userId ?? ""}
                      onReply={handleReply}
                      onRequest={requestDecrypt}
                      onRetry={retryDecrypt}
                      peerName={peer?.displayName ?? "them"}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {peerTyping ? (
          <div className="pointer-events-none absolute bottom-2 left-4">
            <div className="bg-muted/40 rounded-2xl rounded-bl-md px-3.5 py-2.5">
              <TypingDots />
            </div>
          </div>
        ) : null}

        {!pinnedToBottom && allMessages.length > 0 ? (
          <button
            aria-label={
              arrivalCount > 0
                ? `Scroll to ${arrivalCount} new message${arrivalCount === 1 ? "" : "s"}`
                : "Scroll to latest messages"
            }
            className="apple-panel motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 absolute right-4 bottom-4 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-transform duration-150 outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] active:scale-95"
            onClick={jumpToBottom}
            title="Scroll to latest"
            type="button"
          >
            <ArrowDown className="h-5 w-5" />
            {arrivalCount > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold text-white tabular-nums shadow-sm">
                {formatArrivalCount(arrivalCount)}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      <MessageComposer
        conversation={detail}
        replyTarget={replyTarget}
        onReplyCancel={() => setReplyTarget(null)}
        onSent={() => {
          scheduleRead();
          // Sending always returns the user to the newest message, even from
          // mid-history, matching every mainstream chat client.
          jumpToBottom();
        }}
      />
    </div>
  );
}

interface VirtualRowProps {
  historyVersion: number;
  message: MessageData;
  messagesById: Map<string, MessageData>;
  myUserId: string;
  onReply: (message: MessageData) => void;
  onRequest: (message: MessageData | undefined) => void;
  onRetry: (message: MessageData) => void;
  peerName: string;
}

// One virtualized transcript row. Subscribes to its own decrypt entry (and,
// when it quotes a reply, the parent's) so a completion batch re-renders only
// the rows whose payloads landed, never the whole visible window.
function VirtualRowInner({
  message,
  messagesById,
  myUserId,
  onReply,
  onRequest,
  onRetry,
  peerName,
}: VirtualRowProps) {
  const mine = message.senderId === myUserId;
  const payload = useDecryptEntry(message.id);

  // Self-heal: an entry can legitimately be missing while the row is mounted
  // (evicted from the LRU, dropped by scope reset, or cleared after key
  // healing). Re-request it so the bubble can never stay a permanent skeleton.
  useEffect(() => {
    if (payload === undefined) {
      onRequest(message);
    }
  }, [message, onRequest, payload]);

  // Resolve the quoted parent only once our own payload names it, then ask
  // the decryptor for the parent's payload if it is not cached yet.
  const replyToId =
    payload && payload !== "error" && payload !== "pending"
      ? payload.replyToId
      : undefined;
  const parent = replyToId ? messagesById.get(replyToId) : undefined;
  const parentPayload = useDecryptEntry(parent?.id);

  useEffect(() => {
    if (parent && parentPayload === undefined) {
      onRequest(parent);
    }
  }, [onRequest, parent, parentPayload]);

  const quote = useMemo(() => {
    if (!payload || payload === "error" || payload === "pending") {
      return null;
    }
    if (!replyToId || !parent) {
      return null;
    }
    if (
      !parentPayload ||
      parentPayload === "error" ||
      parentPayload === "pending"
    ) {
      return null;
    }
    return {
      content: quoteContent(parent, parentPayload),
      senderName:
        parent.senderId === myUserId
          ? "You"
          : (parent.sender?.displayName ?? peerName),
    };
  }, [myUserId, parent, parentPayload, payload, peerName, replyToId]);

  if (message.deletedAt) {
    return (
      <div
        className={cn(
          "flex items-end gap-2 px-4 pb-1",
          mine ? "justify-end" : "justify-start"
        )}
      >
        {mine ? null : (
          <UserAvatar avatarUrl={message.sender?.avatarUrl ?? null} size={28} />
        )}
        <div className="text-muted-foreground/60 border-border/40 my-0.5 max-w-[85%] min-w-0 rounded-2xl border border-dashed px-3.5 py-2 text-xs italic sm:max-w-[75%]">
          This message was deleted
        </div>
      </div>
    );
  }

  if (!payload || payload === "pending") {
    return (
      <div
        className={cn(
          "flex items-end gap-2 px-4 pb-1",
          mine ? "justify-end" : "justify-start"
        )}
      >
        {mine ? null : (
          <div className="bg-muted/40 h-7 w-7 shrink-0 animate-pulse rounded-full" />
        )}
        <div
          className={cn(
            "h-9 w-48 animate-pulse rounded-2xl",
            mine
              ? "rounded-br-sm bg-current opacity-10"
              : "bg-muted/40 rounded-bl-sm"
          )}
        />
      </div>
    );
  }

  if (payload === "error") {
    return (
      <div
        className={cn(
          "flex items-end gap-2 px-4 pb-1",
          mine ? "justify-end" : "justify-start"
        )}
      >
        <div className="border-border/60 bg-muted/30 flex max-w-[85%] items-center gap-2 rounded-2xl border px-3.5 py-2 text-xs sm:max-w-[75%]">
          <span className="text-muted-foreground italic">
            Couldn&apos;t decrypt this message
          </span>
          <button
            className="text-primary font-medium hover:underline"
            onClick={() => onRetry(message)}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in px-4 pb-1 duration-200">
      <MessageBubble
        content={payload}
        isDecrypting={false}
        message={message}
        myUserId={myUserId}
        onReply={() => onReply(message)}
        peerName={peerName}
        quote={quote}
      />
    </div>
  );
}

// `messagesById` is a fresh Map on every message-list change, so the default
// shallow compare would re-render every visible row on each incoming message.
// Compare only what a row actually renders on: its own message identity, the
// history version (prepends can introduce a reply parent), identity, peer
// name, and the stable callbacks. Rows instead re-render from their own
// decrypt subscription when a payload lands.
const VirtualRow = memo(
  VirtualRowInner,
  (prev, next) =>
    prev.message === next.message &&
    prev.historyVersion === next.historyVersion &&
    prev.myUserId === next.myUserId &&
    prev.peerName === next.peerName &&
    prev.onReply === next.onReply &&
    prev.onRequest === next.onRequest &&
    prev.onRetry === next.onRetry
);

function ThreadHeader({
  conversation,
  onBack,
  onToggleRail,
  peer,
  peerPresence,
  peerTyping,
  privateKey,
}: {
  conversation: ConversationDetailResponse;
  onBack: () => void;
  onToggleRail: () => void;
  peer:
    | ConversationDetailResponse["conversation"]["members"][number]["user"]
    | undefined;
  peerPresence: "idle" | "online" | null;
  peerTyping: boolean;
  privateKey: CryptoKey | null;
}) {
  const { user } = useSession();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const myWrapped = findMyWrappedKey(conversation.keys, user?.id ?? "");
  const peerPublicKey = findPeerPublicKey(
    conversation.conversation,
    user?.id ?? ""
  );

  // Compute the (myPub, peerPub) fingerprint for out-of-band verification.
  useEffect(() => {
    let cancelled = false;
    async function compute() {
      if (!user?.id || !peerPublicKey || !myWrapped || !privateKey) {
        return;
      }
      try {
        // Export the private key's JWK and re-import it as the public key to
        // feed the fingerprint derivation. Only the public point (crv/kty/x/y)
        // is needed, so strip the private material before it touches the
        // import.
        const myJwk = await exportPublicKeyJwk(privateKey);
        const myPublicJwk = {
          crv: myJwk.crv,
          kty: myJwk.kty,
          x: myJwk.x,
          y: myJwk.y,
        };
        const myPublicKey = await importPublicKeyJwk(myPublicJwk);
        const peerPublicKeyObj = await publicKeyBase64ToJwk(peerPublicKey);
        const peerKey = await importPublicKeyJwk(peerPublicKeyObj);
        const fp = await generateFingerprint(
          myPublicKey,
          peerKey,
          peerPublicKey
        );
        if (cancelled) {
          return;
        }
        setFingerprint(fp);
        const saved = localStorage.getItem(`asm:verify:${peer?.id ?? ""}`);
        if (saved === fp) {
          setVerified(true);
        } else if (saved) {
          setKeyChanged(true);
        }
      } catch {
        // Fingerprint is best-effort; the thread still works without it.
      }
    }
    void compute();
    return () => {
      cancelled = true;
    };
  }, [myWrapped, peer?.id, peerPublicKey, privateKey, user?.id]);

  const toggleVerified = useCallback(() => {
    if (!fingerprint || !peer) {
      return;
    }
    if (verified) {
      localStorage.removeItem(`asm:verify:${peer.id}`);
      setVerified(false);
    } else {
      localStorage.setItem(`asm:verify:${peer.id}`, fingerprint);
      setVerified(true);
      setKeyChanged(false);
    }
  }, [fingerprint, peer, verified]);

  return (
    <div className="border-border/60 flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
      <button
        aria-label="Back to conversations"
        className="icon-btn-3d -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full md:hidden"
        onClick={onBack}
        title="Back to conversations"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Link
            className="min-w-0 truncate hover:underline"
            href={peer ? `/users/${peer.username}` : "#"}
          >
            {peer?.displayName ?? "Conversation"}
          </Link>
          <UserBadge badge={peer?.badge} badges={peer?.badges} />
        </p>
        {peerTyping ? (
          <p className="text-primary truncate text-xs font-medium">typing…</p>
        ) : (
          <p className="text-muted-foreground truncate text-xs">
            <Link
              className="hover:underline"
              href={peer ? `/users/${peer.username}` : "#"}
            >
              {presenceLabel(peerPresence, peer?.username)}
            </Link>
          </p>
        )}
      </div>

      {fingerprint ? (
        <button
          aria-label={verifyLabel(keyChanged, verified, fingerprint)}
          className={cnVerify(verified, keyChanged)}
          onClick={toggleVerified}
          title={verifyTitle(keyChanged, verified, fingerprint)}
          type="button"
        >
          {verifyIcon(keyChanged, verified)}
        </button>
      ) : null}

      <button
        aria-label="Online friends"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full lg:hidden"
        onClick={onToggleRail}
        title="Online friends"
        type="button"
      >
        <Users className="h-4 w-4" />
      </button>

      <button
        aria-label="Close chat"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        onClick={onBack}
        title="Close chat"
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Three-dot typing indicator, matching the chat bubble style.
function TypingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((index) => (
        <span
          className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full"
          key={index}
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </span>
  );
}

// Single-line preview for a quoted reply message, keeping long messages from
// blowing up the quote block.
function truncateQuote(text: string, max = 90): string {
  const trimmed = text.replaceAll(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// Short label for a non-text message, used in quote blocks and reply previews.
function mediaLabel(payload: MessagePayload): string {
  if (payload.type === "post") {
    return "Shared a post";
  }
  if (payload.type === "media") {
    return payload.kind === "gif" ? "Shared a GIF" : "Shared an image";
  }
  return truncateQuote(payload.content);
}

// Resolve the reply-quote body for a decrypted parent message.
function quoteContent(parent: MessageData, payload: MessagePayload): string {
  if (parent.deletedAt) {
    return "This message was deleted";
  }
  return mediaLabel(payload);
}

// Short preview of a message shown in the composer's "Replying to" bar.
function replyPreview(payload: DecryptEntry | undefined): string | undefined {
  if (!payload || payload === "error" || payload === "pending") {
    return undefined;
  }
  if (payload.type === "text") {
    return truncateQuote(payload.content, 60);
  }
  return mediaLabel(payload);
}

function presenceLabel(
  presence: "idle" | "online" | null,
  username: string | undefined
): string {
  if (presence === "online") {
    return "Online";
  }
  if (presence === "idle") {
    return "Idle";
  }
  return `@${username ?? ""}`;
}

function verifyLabel(
  keyChanged: boolean,
  verified: boolean,
  fingerprint: string
): string {
  if (keyChanged) {
    return "Identity key changed, tap to re-verify";
  }
  return verified ? `Verified · ${fingerprint}` : `Verify · ${fingerprint}`;
}

function verifyTitle(
  keyChanged: boolean,
  verified: boolean,
  fingerprint: string
): string {
  if (keyChanged) {
    return `Identity key changed — tap to re-verify (${fingerprint})`;
  }
  return verified
    ? `Verified · ${fingerprint}`
    : `Tap to verify · ${fingerprint}`;
}

function verifyIcon(keyChanged: boolean, verified: boolean): React.ReactNode {
  if (keyChanged) {
    return <ShieldAlert className="h-4 w-4 text-amber-500" />;
  }
  if (verified) {
    return <ShieldCheck className="h-4 w-4 text-green-500" />;
  }
  return <KeyRound className="text-muted-foreground h-4 w-4" />;
}

function cnVerify(verified: boolean, keyChanged: boolean): string {
  const base =
    "icon-btn-3d flex h-8 w-8 items-center justify-center rounded-full";
  if (keyChanged) {
    return `${base} border border-amber-500/50`;
  }
  if (verified) {
    return `${base} border border-green-500/40`;
  }
  return base;
}
