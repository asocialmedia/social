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
  useSyncExternalStore,
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
  findMyWrappedKey,
  findPeerPublicKey,
  useRootKeyStore,
} from "@/lib/messages/use-decryption";
import { useMessagesRealtime } from "@/lib/messages/use-messages-realtime";
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
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decrypt results live in the session decryptor (shared across threads,
  // survives remounts). This subscribes to its version so rows re-render
  // exactly when their batch of results lands.
  const decryptVersion = useSyncExternalStore(
    messageDecryptor.subscribe,
    messageDecryptor.getVersion
  );

  const { data: detail } = useQuery({
    queryFn: () => fetchConversationDetail(conversationId),
    queryKey: ["message-conversation", conversationId],
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
    scrollEndThreshold: 100,
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
  // near, and deleted rows need no payload at all. Reply parents of visible
  // rows ride along so quotes pop in with the reply.
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
      items.push({
        conversationId,
        message: {
          ciphertext: message.ciphertext,
          id: message.id,
          iv: message.iv,
          ratchetIndex: message.ratchetIndex,
          senderId: message.senderId,
        },
      });
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
    for (const item of items) {
      const payload = messageDecryptor.get(item.message.id);
      if (payload && payload !== "error" && payload !== "pending") {
        const parent = payload.replyToId
          ? messagesById.get(payload.replyToId)
          : undefined;
        push(parent);
      }
    }
    messageDecryptor.request(items, { getBaseKey });
    // decryptVersion re-runs this as payloads land (reply parents), and the
    // range key re-runs it on scroll; request() itself is a cheap skip for
    // cached, queued, and in-flight ids.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- trigger-only deps: virtualRangeKey/decryptVersion re-run the cheap request skip-scan
  }, [
    allMessages,
    conversationId,
    decryptVersion,
    detail,
    getBaseKey,
    messagesById,
    rootKeyStore,
    userId,
    virtualRangeKey,
    rowVirtualizer,
  ]);

  // Healed keys (re-provisioned identity, first wrapped-key post) must retry
  // payloads that previously failed: drop errors back to unrequested so the
  // request effect above picks them up.
  useEffect(() => {
    if (!detail || !rootKeyStore || !userId) {
      return;
    }
    messageDecryptor.clearErrors();
  }, [detail, rootKeyStore, userId]);

  // Start pinned to the latest message; anchorTo "end" keeps it there.
  useLayoutEffect(() => {
    rowVirtualizer.scrollToEnd();
  }, [rowVirtualizer, conversationId]);

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
      messageDecryptor.request(
        [
          {
            conversationId,
            message: {
              ciphertext: message.ciphertext,
              id: message.id,
              iv: message.iv,
              ratchetIndex: message.ratchetIndex,
              senderId: message.senderId,
            },
          },
        ],
        { getBaseKey }
      );
    },
    [conversationId, detail, getBaseKey, rootKeyStore, userId]
  );

  // Mark the conversation read when it opens and when the peer sends while
  // the thread is open (debounced so burst sends only fire one request).
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
    // network drops). Event folds keep the cache fresh otherwise, so no
    // per-message refetch storm.
    useCallback(() => {
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
                const payload = messageDecryptor.get(message.id);
                const replyToId =
                  payload && payload !== "error" && payload !== "pending"
                    ? payload.replyToId
                    : undefined;
                const parent = replyToId
                  ? messagesById.get(replyToId)
                  : undefined;
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
                      message={message}
                      myUserId={userId ?? ""}
                      onReply={handleReply}
                      onRetry={retryDecrypt}
                      parent={parent}
                      parentPayload={
                        parent ? messageDecryptor.get(parent.id) : undefined
                      }
                      payload={payload}
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
      </div>

      <MessageComposer
        conversation={detail}
        replyTarget={replyTarget}
        onReplyCancel={() => setReplyTarget(null)}
        onSent={() => scheduleRead()}
      />
    </div>
  );
}

interface VirtualRowProps {
  message: MessageData;
  myUserId: string;
  onReply: (message: MessageData) => void;
  onRetry: (message: MessageData) => void;
  parent: MessageData | undefined;
  parentPayload: DecryptEntry | undefined;
  payload: DecryptEntry | undefined;
  peerName: string;
}

// One virtualized transcript row. Memoized on its own payload (plus the
// reply parent's) so a decrypt result re-renders only the rows it touches,
// never the whole visible window.
function VirtualRowInner({
  message,
  myUserId,
  onReply,
  onRetry,
  parent,
  parentPayload,
  payload,
  peerName,
}: VirtualRowProps) {
  const mine = message.senderId === myUserId;

  const quote = useMemo(() => {
    if (!payload || payload === "error" || payload === "pending") {
      return null;
    }
    const { replyToId } = payload;
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
  }, [myUserId, parent, parentPayload, payload, peerName]);

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

const VirtualRow = memo(VirtualRowInner);

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
