"use client";

import type { MessageData, MessagePage } from "@asm/db";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  ArrowLeft,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
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
  publicKeyBase64ToJwk,
} from "@/lib/messages/crypto";
import {
  decryptMessageWithRootKey,
  findMyWrappedKey,
  findPeerPublicKey,
  useRootKeyStore,
} from "@/lib/messages/use-decryption";
import { useMessagesRealtime } from "@/lib/messages/use-messages-realtime";
import { usePresence } from "@/lib/messages/use-presence";

interface MessageThreadProps {
  conversationId: string;
  onBack: () => void;
  onToggleRail: () => void;
}

type DecryptedCache = Record<string, MessagePayload | "error" | "pending">;

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

  const [decrypted, setDecrypted] = useState<DecryptedCache>({});
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
  const decryptedRef = useRef(decrypted);
  const pinnedToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  // Keep the decrypt cache ref in sync without touching refs during render.
  useEffect(() => {
    decryptedRef.current = decrypted;
  }, [decrypted]);

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

  // Messages whose payload hasn't finished decrypting yet. Shown as one
  // aggregate line at the bottom instead of a spinner on every bubble.
  const pendingCount = useMemo(
    () =>
      allMessages.filter((message) => decrypted[message.id] === "pending")
        .length,
    [allMessages, decrypted]
  );

  const peer = detail?.conversation.members.find(
    (member) => member.userId !== user?.id
  )?.user;
  const peerPresence = peer
    ? (onlineUsers.find((u) => u.id === peer.id)?.status ?? null)
    : null;

  // Resolve a message's reply parent into a display quote. The parent's own
  // decrypted payload comes from the same cache, so the quote pops in as soon
  // as the parent finishes decrypting.
  const replyQuoteFor = useCallback(
    (message: MessageData): { content: string; senderName: string } | null => {
      const payload = decrypted[message.id];
      if (!payload || payload === "error" || payload === "pending") {
        return null;
      }
      const { replyToId } = payload;
      if (!replyToId) {
        return null;
      }
      const parent = messagesById.get(replyToId);
      if (!parent) {
        return null;
      }
      const parentPayload = decrypted[parent.id];
      if (
        !parentPayload ||
        parentPayload === "error" ||
        parentPayload === "pending"
      ) {
        return null;
      }
      const senderName =
        parent.senderId === user?.id
          ? "You"
          : (parent.sender?.displayName ?? peer?.displayName ?? "them");
      return {
        content: quoteContent(parent, parentPayload),
        senderName,
      };
    },
    [decrypted, messagesById, peer?.displayName, user?.id]
  );

  const decrypt = useCallback(
    async (messageId: string) => {
      const message = allMessages.find((m) => m.id === messageId);
      if (!message || !detail) {
        return;
      }
      const payload = await decryptMessageWithRootKey(
        rootKeyStore,
        detail.conversation,
        user?.id ?? "",
        message
      );
      setDecrypted((prev) => ({
        ...prev,
        [messageId]: payload ?? "error",
      }));
    },
    [allMessages, detail, rootKeyStore, user?.id]
  );

  // Decrypt any messages not yet in the cache. Retried when rootKeyStore, detail
  // or message list changes so messages decrypt as soon as keys are available.
  useEffect(() => {
    if (!rootKeyStore) {
      return;
    }
    for (const message of allMessages) {
      const state = decryptedRef.current[message.id];
      if (state === undefined || state === "error") {
        setDecrypted((prev) => ({ ...prev, [message.id]: "pending" }));
        void decrypt(message.id);
      }
    }
  }, [allMessages, decrypt, rootKeyStore]);

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
  }, [conversationId, scheduleRead]);

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

  useMessagesRealtime(conversationId, handleEvent, Boolean(user));

  // Clear the typing timer when the thread unmounts.
  useEffect(
    () => () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    },
    []
  );

  // Track whether the user is reading near the bottom, so a new message pins
  // the scroll but a prepended older page does not yank the viewport.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      pinnedToBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    return () => el.removeEventListener("scroll", measure);
  }, []);

  // Keep the scroll pinned to the bottom for new messages and the typing
  // indicator. When the user has scrolled up, or an older page is being
  // fetched, preserve the viewport instead: offset by the height that grew
  // above (prepended history / decrypted bubbles resizing) so the same
  // messages stay in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      prevScrollHeightRef.current = 0;
      return;
    }
    const previousHeight = prevScrollHeightRef.current;
    prevScrollHeightRef.current = el.scrollHeight;
    const fetchingOlder = messagesQuery.isFetchingPreviousPage;

    if (pinnedToBottomRef.current && !fetchingOlder) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (previousHeight > 0 && !fetchingOlder) {
      el.scrollTop += el.scrollHeight - previousHeight;
    }
  }, [
    allMessages.length,
    decrypted,
    messagesQuery.isFetchingPreviousPage,
    peerTyping,
  ]);

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

      <div
        className="hide-native-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-4"
        ref={scrollRef}
      >
        {messagesQuery.hasPreviousPage ? (
          <button
            className="text-muted-foreground hover:text-foreground mx-auto text-xs font-medium transition-colors"
            onClick={() => {
              void messagesQuery.fetchPreviousPage();
            }}
            type="button"
          >
            Load older messages
          </button>
        ) : null}

        {allMessages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
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
          allMessages.map((message) => {
            const decryptedPayload = decrypted[message.id];
            return (
              <MessageBubble
                content={
                  decryptedPayload &&
                  decryptedPayload !== "error" &&
                  decryptedPayload !== "pending"
                    ? decryptedPayload
                    : null
                }
                isDecrypting={decryptedPayload === "pending"}
                key={message.id}
                message={message}
                myUserId={user?.id ?? ""}
                onReply={() => {
                  const payload = decrypted[message.id];
                  setReplyTarget({
                    content: replyPreview(payload),
                    id: message.id,
                    senderId: message.senderId,
                    senderName:
                      message.senderId === user?.id
                        ? "You"
                        : (message.sender?.displayName ??
                          peer?.displayName ??
                          "them"),
                  });
                }}
                peerName={peer?.displayName ?? "them"}
                quote={replyQuoteFor(message)}
              />
            );
          })
        )}

        {peerTyping ? (
          <div className="flex justify-start">
            <div className="bg-muted/40 rounded-2xl rounded-bl-md px-3.5 py-2.5">
              <TypingDots />
            </div>
          </div>
        ) : null}

        {pendingCount > 0 ? (
          <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-2 text-xs">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {pendingCount === 1
              ? "Decrypting a message…"
              : `Decrypting ${pendingCount} messages…`}
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
          <UserBadge badge={peer?.badge} />
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
function replyPreview(
  payload: DecryptedCache[string] | undefined
): string | undefined {
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
