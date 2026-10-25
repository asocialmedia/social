"use client";

import {
  BubbleEntranceRegistry,
  observeChatTask,
  runChatTask,
  throwChatError,
  deriveIncognitoRootKey,
  incognitoMessageExpiresAt,
  extractMessageReferences,
} from "@asm/messages";
// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.
import type { IncognitoMessage, IncognitoSession } from "@asm/messages";
// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Shield } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { toast } from "@/lib/gooey-toast";
import {
  createRootKeyStore,
  ensureConversationKeys,
  fetchConversationDetail,
  resolveMyConversationWraps,
  toggleMessageReaction,
} from "@/lib/messages/client";
import { decryptMessage, encryptMessage } from "@/lib/messages/crypto";
import type { MessagePayload } from "@/lib/messages/crypto";
import {
  ChatControlError,
  chatControlRequest,
  fetchIncognitoPage,
} from "@/lib/messages/lifecycle-client";
import type { PaneRect } from "@/lib/messages/message-gestures";

import { MessageBubble } from "./message-bubble";
import { bubblePosition } from "./message-bubble-shape";
import { MessageComposer } from "./message-composer";
import { mediaFlatKey } from "./message-conversation-media";
import { ConversationMediaViewer } from "./message-conversation-viewer";
import { getMessageGroupMeta, formatTimeDivider } from "./message-grouping";
import {
  ConversationMediaViewerProvider,
  ConversationViewOnceProvider,
} from "./message-media-viewer-context";
import { MessageOptionsMenu } from "./message-options-menu";

interface Row {
  message: IncognitoMessage;
  payload: MessagePayload | null;
}
interface Pending {
  id: string;
  signature: string;
}
export function IncognitoThread({
  conversationId,
  session,
  serverNow,
  fresh,
  revision,
  onRefresh,
  busy,
  error: lifecycleError,
}: {
  conversationId: string;
  session: IncognitoSession;
  serverNow: string;
  fresh: boolean;
  revision: number;
  onRefresh: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const [rows, setRows] = useState<Row[]>([]);
  const entrances = useMemo(() => new BubbleEntranceRegistry(), []);
  const latestIds = useRef<Set<string> | null>(null);
  const [mediaAnchor, setMediaAnchor] = useState<string | null>(null);
  const [reactionMenu, setReactionMenu] = useState<{
    id: string;
    anchor: PaneRect;
  } | null>(null);
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    senderId: string;
    senderName?: string;
    content?: string;
  } | null>(null);
  const { data: detail } = useQuery({
    queryFn: () => fetchConversationDetail(conversationId),
    queryKey: ["message-conversation", conversationId],
  });
  const [sendBusy, setSendBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [latest, setLatest] = useState(true);
  const [clock, setClock] = useState(Date.now);
  const [foreground, setForeground] = useState(
    () => document.visibilityState === "visible" && navigator.onLine
  );
  // oxlint-disable-next-line react/hook-use-state -- The session clock offset stays fixed for this mount.
  const [clockOffset] = useState(() => Date.parse(serverNow) - Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const reactionLocks = useRef(new Set<string>());
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const canView = fresh && foreground && !session.endedAt;
  useEffect(() => {
    const expired = rows.filter(
      ({ message }) => incognitoMessageExpiresAt(message) <= clock + clockOffset
    );
    if (!expired.length) {
      return;
    }
    const ids = new Set(expired.map(({ message }) => message.id));
    queueMicrotask(() => {
      setRows((current) =>
        current.filter(({ message }) => !ids.has(message.id))
      );
      setReplyTarget((current) =>
        current && ids.has(current.id) ? null : current
      );
    });
  }, [clock, clockOffset, rows]);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const visibility = () => {
      setForeground(document.visibilityState === "visible" && navigator.onLine);
      onRefresh();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", visibility);
    window.addEventListener("online", visibility);
    return () => {
      mounted.current = false;
      readGeneration.current += 1;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", visibility);
      window.removeEventListener("online", visibility);
    };
  }, [onRefresh]);
  const readPage = useCallback(
    async (signal: AbortSignal, before?: number) => {
      if (!privateKey || !user) {
        throwChatError(new Error("Unlock your messages to open this session."));
      }
      readGeneration.current += 1;
      const generation = readGeneration.current;
      const [page, pageDetail] = await Promise.all([
        fetchIncognitoPage(conversationId, session.id, signal, before),
        fetchConversationDetail(conversationId),
      ]);
      const peer = pageDetail.conversation.members.find(
        (member) => member.userId !== user.id
      );
      const store = createRootKeyStore(privateKey);
      const roots = await store.getRootKeys(
        conversationId,
        resolveMyConversationWraps(
          pageDetail.keys,
          pageDetail.conversation,
          user.id
        ),
        peer?.user.messageIdentity?.publicKey ?? ""
      );
      const sessionRoots = await Promise.all(
        roots.map((key) => deriveIncognitoRootKey(key, session.id))
      );
      const decoded: Row[] = [];
      for (const message of page.messages) {
        let payload: MessagePayload | null = null;
        for (const root of sessionRoots) {
          try {
            payload = await decryptMessage(
              root,
              message.senderId,
              session.id,
              message
            );
            break;
          } catch {
            // Reconcile safely on the next request; do not expose source errors.
          }
        }
        decoded.push({ message, payload });
      }
      if (
        !mounted.current ||
        signal.aborted ||
        generation !== readGeneration.current
      ) {
        return;
      }
      const element = scrollRef.current;
      const previousHeight = element?.scrollHeight ?? 0;
      const previousTop = element?.scrollTop ?? 0;
      const nearBottom = element
        ? element.scrollHeight - element.scrollTop - element.clientHeight < 100
        : true;
      if (before === undefined) {
        if (nearBottom && latestIds.current) {
          for (const row of decoded) {
            if (!latestIds.current.has(row.message.id)) {
              entrances.register(row.message.id);
            }
          }
        }
        latestIds.current = new Set(decoded.map((row) => row.message.id));
      }
      setRows((previous) =>
        before === undefined
          ? decoded
          : [...decoded, ...previous]
              .filter(
                (row, index, array) =>
                  array.findIndex(
                    (candidate) => candidate.message.id === row.message.id
                  ) === index
              )
              .slice(0, 200)
      );
      setHasMore(page.hasMore);
      setReadBusy(false);
      setLocalError(null);
      if (before !== undefined) {
        requestAnimationFrame(() => {
          const scroller = scrollRef.current;
          if (scroller) {
            scroller.scrollTop =
              previousTop + scroller.scrollHeight - previousHeight;
          }
        });
      } else if (nearBottom) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        });
      }
    },
    [privateKey, user, conversationId, session.id, entrances]
  );

  const reactToMessage = useCallback(
    async (messageId: string, emoji: string) => {
      if (reactionLocks.current.has(messageId)) {
        return;
      }
      reactionLocks.current.add(messageId);
      try {
        const reactions = await toggleMessageReaction(
          conversationId,
          messageId,
          emoji,
          session.id
        );
        setRows((current) =>
          current.map((row) =>
            row.message.id === messageId
              ? { ...row, message: { ...row.message, reactions } }
              : row
          )
        );
      } catch (error) {
        toast({
          description:
            error instanceof Error
              ? error.message
              : "Couldn't update reaction.",
          title: "Reaction failed",
          variant: "destructive",
        });
      }
      reactionLocks.current.delete(messageId);
    },
    [conversationId, session.id]
  );
  useEffect(() => {
    if (!canView) {
      readGeneration.current += 1;
      queueMicrotask(() => setRows([]));
      return;
    }
    if (!latest) {
      return;
    }
    const controller = new AbortController();
    void observeChatTask(
      readPage(controller.signal),
      () => {
        // This task has no success update.
      },
      (requestFailure) => {
        if (!controller.signal.aborted && mounted.current) {
          setReadBusy(false);
          setRows([]);
          setLocalError(
            requestFailure instanceof Error
              ? requestFailure.message
              : "Messages couldn't be loaded. Retry."
          );
        }
      }
    );
    return () => controller.abort();
  }, [canView, revision, session.nextSequence, latest, readPage]);
  const send = async (payload: MessagePayload): Promise<boolean> => {
    if (sendBusy || busy || !canView || !user || !privateKey) {
      return false;
    }
    setSendBusy(true);
    setLocalError(null);
    return await runChatTask(
      async () => {
        try {
          let current = await fetchConversationDetail(conversationId);
          const provisioned = await ensureConversationKeys(
            current.conversation,
            privateKey,
            user.id,
            {
              refreshConversation: async () => {
                const refreshed = await fetchConversationDetail(conversationId);
                return refreshed.conversation;
              },
            }
          );
          if (!provisioned) {
            throwChatError(
              new Error("Message keys are unavailable. Please retry.")
            );
          }
          current = await fetchConversationDetail(conversationId);
          const wraps = resolveMyConversationWraps(
            current.keys,
            current.conversation,
            user.id
          );
          const peer = current.conversation.members.find(
            (member) => member.userId !== user.id
          );
          const roots = await createRootKeyStore(privateKey).getRootKeys(
            conversationId,
            wraps,
            peer?.user.messageIdentity?.publicKey ?? ""
          );
          if (!roots[0] || !wraps[0]) {
            throwChatError(
              new Error("Message keys are unavailable. Please retry.")
            );
          }
          const root = await deriveIncognitoRootKey(roots[0], session.id);
          const signature = JSON.stringify(payload);
          if (!pending.current || pending.current.signature !== signature) {
            pending.current = { id: crypto.randomUUID(), signature };
          }
          const { id } = pending.current;
          let index = session.nextSequence;
          for (let attempt = 0; ; attempt += 1) {
            const encrypted = await encryptMessage(
              root,
              user.id,
              index,
              session.id,
              payload
            );
            try {
              await chatControlRequest(conversationId, "incognito", {
                body: JSON.stringify({
                  ...encrypted,
                  id,
                  keyEpoch: wraps[0].version,
                  mediaIds: extractMessageReferences(payload).flatMap((ref) =>
                    ref.kind === "media" && ref.requiredId
                      ? [ref.requiredId]
                      : []
                  ),
                  sessionId: session.id,
                  viewOnceMediaIds:
                    payload.type === "media" && "attachments" in payload
                      ? payload.attachments.flatMap((attachment) =>
                          attachment.kind === "view-once"
                            ? [attachment.ref]
                            : []
                        )
                      : [],
                }),
                method: "POST",
              });
              entrances.register(id);
              pending.current = null;
              if (mounted.current) {
                setLatest(true);
              }
              return true;
            } catch (error) {
              if (
                error instanceof ChatControlError &&
                error.expectedIndex !== undefined &&
                attempt < 2
              ) {
                index = error.expectedIndex;
                continue;
              }
              throwChatError(error);
            }
          }
        } catch (error) {
          if (mounted.current) {
            setLocalError(
              error instanceof Error
                ? error.message
                : "Message couldn't be sent. Please retry."
            );
            onRefresh();
          }
          return false;
        }
      },
      () => {
        if (mounted.current) {
          setSendBusy(false);
        }
      }
    );
  };
  const loadEarlier = async () => {
    const before = rows[0]?.message.sequence;
    if (before === undefined) {
      return;
    }
    setLatest(false);
    setReadBusy(true);
    try {
      await readPage(new AbortController().signal, before);
    } catch {
      setLocalError("Earlier messages couldn't be loaded. Retry.");
      setReadBusy(false);
    }
  };
  const visibleRows = canView
    ? rows.filter(
        ({ message }) =>
          incognitoMessageExpiresAt(message) > clock + clockOffset
      )
    : [];
  const peer = detail?.conversation.members.find(
    (member) => member.userId !== user?.id
  )?.user;
  const messages = visibleRows.map(({ message }) => message);
  const mediaMessages = visibleRows.map(({ message }) => ({
    ...message,
    deletedAt: null,
  }));
  const activeMediaAnchor =
    mediaAnchor &&
    visibleRows.some(({ message }) => mediaAnchor.startsWith(`${message.id}:`))
      ? mediaAnchor
      : null;
  return (
    <ConversationMediaViewerProvider
      value={({ messageId, imageIndex }) =>
        setMediaAnchor(mediaFlatKey(messageId, imageIndex))
      }
    >
      <ConversationViewOnceProvider value={conversationId}>
        <section
          aria-label="Incognito conversation"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
            ref={scrollRef}
            aria-label="Incognito messages"
          >
            {readBusy && !rows.length ? (
              <div aria-live="polite" className="flex justify-center p-8">
                <ZephLoader variant="messages" className="size-5" />
                <span className="sr-only">Opening messages</span>
              </div>
            ) : null}
            {canView ? (
              <>
                {hasMore ? (
                  <div className="mb-4 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readBusy}
                      onClick={() => {
                        void loadEarlier();
                      }}
                    >
                      Load earlier messages
                    </Button>
                  </div>
                ) : null}
                {!visibleRows.length && !readBusy && !localError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
                    <Shield className="size-8" />
                    <p className="text-sm">No messages yet</p>
                  </div>
                ) : null}
                <div className="space-y-1">
                  {visibleRows.map(({ message, payload }, index) => {
                    const group = getMessageGroupMeta(messages, index);
                    const quoted = payload?.replyToId
                      ? visibleRows.find(
                          (row) => row.message.id === payload.replyToId
                        )
                      : undefined;
                    const quoteName =
                      quoted?.message.senderId === user?.id
                        ? "You"
                        : (peer?.displayName ?? "Message");
                    const quote = quoted
                      ? {
                          content: quoted.payload?.content ?? "Attachment",
                          senderName: quoteName,
                        }
                      : null;
                    return (
                      <div
                        data-message-row=""
                        id={`incognito-message-${message.id}`}
                        key={message.id}
                        className={group.isFirstInGroup ? "pt-3" : ""}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          const rect = event.currentTarget
                            .querySelector("[data-message-bubble]")
                            ?.getBoundingClientRect();
                          if (rect) {
                            setReactionMenu({ anchor: rect, id: message.id });
                          }
                        }}
                        onDoubleClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest(
                              "button, a, video, audio, [role=button]"
                            )
                          ) {
                            return;
                          }
                          void reactToMessage(message.id, "❤️");
                        }}
                      >
                        {group.showTimeDivider ? (
                          <p className="text-muted-foreground py-3 text-center text-[11px]">
                            {formatTimeDivider(message.createdAt)}
                          </p>
                        ) : null}
                        <MessageBubble
                          entrances={entrances}
                          content={payload}
                          isDecrypting={false}
                          message={{
                            ...message,
                            createdAt: new Date(message.createdAt),
                            deletedAt: null,
                            editedAt: null,
                            sender: detail?.conversation.members.find(
                              (member) => member.userId === message.senderId
                            )?.user,
                          }}
                          myUserId={user?.id ?? ""}
                          onReact={(emoji) => {
                            void reactToMessage(message.id, emoji);
                          }}
                          onMoreOptions={(rect) =>
                            setReactionMenu({ anchor: rect, id: message.id })
                          }
                          onReply={() =>
                            setReplyTarget({
                              content: payload?.content ?? "Attachment",
                              id: message.id,
                              senderId: message.senderId,
                              senderName:
                                message.senderId === user?.id
                                  ? "You"
                                  : peer?.displayName,
                            })
                          }
                          quote={quote}
                          quotePending={false}
                          position={bubblePosition(
                            group.isFirstInGroup,
                            group.isLastInGroup
                          )}
                          selectionActive={false}
                          unknownSenderName="Participant"
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-zinc-400">
                  Reconnect to continue chatting.
                </p>
                <Button variant="outline" onClick={onRefresh}>
                  Retry connection
                </Button>
              </div>
            )}
          </div>
          {latest ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLatest(true);
                onRefresh();
              }}
            >
              Return to latest messages
            </Button>
          )}
          {localError || lifecycleError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 px-5 py-2 text-sm text-amber-300"
            >
              <span>{localError ?? lifecycleError}</span>
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                <RefreshCw className="mr-1 size-3" />
                Retry
              </Button>
            </div>
          ) : null}
          {detail ? (
            <MessageComposer
              key={session.id}
              conversation={detail}
              incognito={{ send, sessionId: session.id }}
              accessEnded={!canView || busy}
              editTarget={null}
              onDraftInput={() => {
                // Incognito drafts stay in this composer.
              }}
              onEditCancel={() => {
                // This composer sends new messages.
              }}
              onEditSave={() => Promise.resolve(false)}
              onReplyCancel={() => setReplyTarget(null)}
              onSent={onRefresh}
              replyTarget={
                replyTarget &&
                visibleRows.some(({ message }) => message.id === replyTarget.id)
                  ? replyTarget
                  : null
              }
            />
          ) : null}
          {activeMediaAnchor ? (
            <ConversationMediaViewer
              key={activeMediaAnchor}
              anchorKey={activeMediaAnchor}
              messages={mediaMessages}
              readPayload={(id) =>
                visibleRows.find(({ message }) => message.id === id)?.payload ??
                "error"
              }
              hasOlder={hasMore}
              hasNewer={!latest}
              isFetchingOlder={readBusy}
              isFetchingNewer={readBusy}
              onActive={() => {
                // Media selection stays in the viewer.
              }}
              onClose={() => setMediaAnchor(null)}
              onLoadOlder={async () => {
                if (!hasMore || readBusy) {
                  return false;
                }
                await loadEarlier();
                return true;
              }}
              onLoadNewer={() => {
                setLatest(true);
                onRefresh();
                return false;
              }}
              onPosition={() => {
                // The viewer renders its own position.
              }}
            />
          ) : null}
          {reactionMenu &&
          visibleRows.some(({ message }) => message.id === reactionMenu.id) ? (
            <MessageOptionsMenu
              anchorRect={reactionMenu.anchor}
              canDeleteForEveryone={false}
              canEdit={false}
              createdAt={session.startedAt}
              editedAt={null}
              onClose={() => setReactionMenu(null)}
              onCopy={() => setReactionMenu(null)}
              onDeleteForEveryone={() => setReactionMenu(null)}
              onDeleteForMe={() => setReactionMenu(null)}
              onEdit={() => setReactionMenu(null)}
              onReply={() => setReactionMenu(null)}
              onSelect={() => setReactionMenu(null)}
              onReact={(emoji) => {
                const { id } = reactionMenu;
                setReactionMenu(null);
                void reactToMessage(id, emoji);
              }}
              preferEnd={
                visibleRows.find(
                  ({ message }) => message.id === reactionMenu.id
                )?.message.senderId === user?.id
              }
              presentation={
                window.matchMedia("(pointer: coarse)").matches
                  ? "sheet"
                  : "popover"
              }
              reactionOnly
              receipt={null}
            />
          ) : null}
        </section>
      </ConversationViewOnceProvider>
    </ConversationMediaViewerProvider>
  );
}
