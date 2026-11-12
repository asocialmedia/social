// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.
import {
  BubbleEntranceRegistry,
  observeChatTask,
  throwChatError,
  incognitoMessageExpiresAt,
  extractMessageReferences,
} from "@asm/messages";
import type { IncognitoMessage, IncognitoSession } from "@asm/messages";
// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { randomUUID } from "expo-crypto";
import { Shield } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  ensureConversationKeys,
  fetchConversationDetail,
  postConversationKeys,
  toggleMessageReaction,
} from "@/features/messages/lib/client";
import { decryptMessage, encryptMessage } from "@/features/messages/lib/crypto";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { deriveNativeIncognitoRootKey } from "@/features/messages/lib/incognito-crypto";
import {
  NativeChatControlError,
  nativeChatRequest,
  nativeIncognitoPage,
} from "@/features/messages/lib/lifecycle-client";
import {
  closeViewOnceMedia,
  openViewOnceMedia,
} from "@/features/messages/lib/view-once-client";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";

import type { ConversationTheme } from "../lib/conversation-theme";
import { getMediaImages } from "../lib/crypto";
import { nextExpiryDelayMs } from "../lib/incognito-expiry";
import {
  getMessageGroupMeta,
  formatTimeDivider,
} from "../lib/message-grouping";
import type { MessageConversationData } from "../lib/types";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { MessageMediaViewer } from "./message-media-viewer";
import { MessageReactionSheet } from "./message-reaction-sheet";
import { ThreadSkeleton } from "./messages-skeleton";

interface Row {
  message: IncognitoMessage;
  payload: MessagePayload | null;
}

const INCOGNITO_THEME: ConversationTheme = {
  from: "#71717a",
  key: "incognito",
  label: "Incognito",
  ring: "#a1a1aa",
  to: "#52525b",
};

const FALLBACK_GROUP = {
  isFirstInGroup: true,
  isLastInGroup: true,
  showTimeDivider: false,
};

// Memoized for the same reason as the main transcript row: the thread
// re-renders when rows arrive or expire, and only the touched row should
// rebuild its bubble.
const MemoIncognitoRow = memo(
  ({
    conversationId,
    entrances,
    group,
    message,
    mine,
    onCloseViewOnce,
    onLongPress,
    onOpenViewOnce,
    onPressImage,
    onReact,
    payload,
    peerAvatarUrl,
    width,
  }: {
    conversationId: string;
    entrances: BubbleEntranceRegistry;
    group: ReturnType<typeof getMessageGroupMeta>;
    message: IncognitoMessage;
    mine: boolean;
    onCloseViewOnce: (mediaId: string, grantId: string) => Promise<void>;
    onLongPress: (messageId: string) => void;
    onOpenViewOnce: (
      mediaId: string,
      grantId: string,
      signal?: AbortSignal
    ) => Promise<string>;
    onPressImage: (messageId: string, imageIndex: number) => void;
    onReact: (messageId: string, emoji: string) => void;
    payload: MessagePayload | null;
    peerAvatarUrl?: string | null;
    width: number;
  }) => (
    <View>
      {group.showTimeDivider ? (
        <Text
          style={{
            color: "#a1a1aa",
            fontSize: 11,
            paddingVertical: 12,
            textAlign: "center",
          }}
        >
          {formatTimeDivider(message.createdAt)}
        </Text>
      ) : null}
      <Pressable onLongPress={() => onLongPress(message.id)}>
        <View>
          <MessageBubble
            entrances={entrances}
            messageId={message.id}
            ephemeral
            deleted={false}
            edited={false}
            group={group}
            mine={mine}
            payload={payload}
            failed={!payload}
            peerAvatarUrl={peerAvatarUrl}
            theme={INCOGNITO_THEME}
            maxBubbleWidth={width - 32}
            showReceipt={false}
            onPressImage={(imageIndex) => onPressImage(message.id, imageIndex)}
            onOpenViewOnce={onOpenViewOnce}
            conversationId={conversationId}
            onCloseViewOnce={onCloseViewOnce}
            onReact={(emoji) => onReact(message.id, emoji)}
            reactions={message.reactions ?? []}
          />
        </View>
      </Pressable>
    </View>
  )
);
MemoIncognitoRow.displayName = "MemoIncognitoRow";
export function NativeIncognitoThread({
  conversationId,
  session,
  options,
  revision,
  fresh,
  serverOffset,
  onRefresh,
  busy,
  error: lifecycleError,
}: {
  conversationId: string;
  session: IncognitoSession;
  options: ApiCallOptions;
  revision: number;
  fresh: boolean;
  serverOffset: number;
  onRefresh: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { user } = useSessionContext();
  const { privateKey, getBaseKeys, invalidateKeys } = useMessagesIdentity();
  const [rows, setRows] = useState<Row[]>([]);
  const entrances = useMemo(() => new BubbleEntranceRegistry(), []);
  const latestIds = useRef<Set<string> | null>(null);
  const [conversation, setConversation] =
    useState<MessageConversationData | null>(null);
  const [viewer, setViewer] = useState<{
    messageId: string;
    index: number;
  } | null>(null);
  const { width } = useWindowDimensions();
  useEffect(() => {
    const controller = new AbortController();
    void observeChatTask(
      fetchConversationDetail(conversationId, options),
      (detail) => {
        if (!controller.signal.aborted) {
          setConversation(detail.conversation);
        }
      }
    );
    return () => controller.abort();
  }, [conversationId, options]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now);
  const mounted = useRef(true);
  const earlierLoad = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pending = useRef<{ id: string; signature: string } | null>(null);
  const reactionLocks = useRef(new Set<string>());
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const list = useRef<FlatList<Row>>(null);
  const canView = fresh && !session.endedAt;
  const openViewOnce = useCallback(
    (mediaId: string, grantId: string, signal?: AbortSignal) =>
      openViewOnceMedia(conversationId, mediaId, grantId, options, signal),
    [conversationId, options]
  );
  const closeViewOnce = useCallback(
    (mediaId: string, grantId: string) =>
      closeViewOnceMedia(conversationId, mediaId, grantId, options),
    [conversationId, options]
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
          options,
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
    [conversationId, options, session.id]
  );
  useEffect(() => {
    const expired = rows.filter(
      ({ message }) =>
        incognitoMessageExpiresAt(message) <= clock + serverOffset
    );
    if (expired.length) {
      const ids = new Set(expired.map(({ message }) => message.id));
      queueMicrotask(() =>
        setRows((current) =>
          current.filter(({ message }) => !ids.has(message.id))
        )
      );
    }
  }, [clock, serverOffset, rows]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  // A single timeout aimed at the next expiry replaces the old one-second
  // ticker: without it every open incognito thread re-rendered (and rebuilt
  // every bubble) constantly, even with no traffic.
  useEffect(() => {
    if (!canView || rows.length === 0) {
      return;
    }
    const delay = nextExpiryDelayMs(
      rows.map((row) => incognitoMessageExpiresAt(row.message) - serverOffset),
      clock
    );
    if (delay === null) {
      return;
    }
    const timer = setTimeout(() => setClock(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [canView, clock, rows, serverOffset]);
  const load = useCallback(
    async (signal: AbortSignal, before?: number) => {
      generation.current += 1;
      const { current } = generation;
      const page = await nativeIncognitoPage(
        conversationId,
        session.id,
        options,
        signal,
        before
      );
      invalidateKeys(conversationId);
      const awaitedChatState0 = await getBaseKeys(conversationId);
      const roots = awaitedChatState0.map((root) =>
        deriveNativeIncognitoRootKey(root, session.id)
      );
      const decoded: Row[] = [];
      for (const message of page.messages) {
        let payload: MessagePayload | null = null;
        for (const root of roots) {
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
        signal.aborted ||
        !mounted.current ||
        current !== generation.current
      ) {
        return;
      }
      if (before === undefined) {
        if (latestIds.current) {
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
      setLoading(false);
      setLocalError(null);
      if (before === undefined) {
        requestAnimationFrame(() =>
          list.current?.scrollToEnd({ animated: false })
        );
      }
    },
    [
      conversationId,
      session.id,
      options,
      getBaseKeys,
      invalidateKeys,
      entrances,
    ]
  );
  useEffect(() => {
    if (!canView) {
      generation.current += 1;
      queueMicrotask(() => setRows([]));
      return;
    }
    if (!latest) {
      return;
    }
    const controller = new AbortController();
    void observeChatTask(
      load(controller.signal),
      () => {
        // This task has no success update.
      },
      (requestFailure) => {
        if (!controller.signal.aborted && mounted.current) {
          setRows([]);
          setLoading(false);
          setLocalError(
            requestFailure instanceof Error
              ? requestFailure.message
              : "Messages couldn't be loaded. Retry."
          );
        }
      }
    );
    return () => controller.abort();
  }, [canView, latest, revision, session.nextSequence, load]);
  const send = async (payload: MessagePayload) => {
    if (!user || !privateKey || !canView) {
      throwChatError(new Error("Reconnect before sending in incognito."));
    }
    try {
      let detail = await fetchConversationDetail(conversationId, options);
      const root = await ensureConversationKeys(
        detail.conversation,
        privateKey,
        user.id,
        {
          postKeys: (id, keys) => postConversationKeys(id, keys, options),
          refreshConversation: async () => {
            const refreshed = await fetchConversationDetail(
              conversationId,
              options
            );
            return refreshed.conversation;
          },
        }
      );
      if (!root) {
        throwChatError(
          new Error("Message keys are unavailable. Please retry.")
        );
      }
      detail = await fetchConversationDetail(conversationId, options);
      const version = Math.max(
        ...detail.keys
          .filter((key) => key.ownerUserId === user.id)
          .map((key) => key.version ?? 1)
      );
      invalidateKeys(conversationId);
      const roots = await getBaseKeys(conversationId);
      if (!roots[0] || !Number.isSafeInteger(version)) {
        throwChatError(
          new Error("Message keys are unavailable. Please retry.")
        );
      }
      const sessionRoot = deriveNativeIncognitoRootKey(roots[0], session.id);
      const signature = JSON.stringify(payload);
      if (!pending.current || pending.current.signature !== signature) {
        pending.current = { id: randomUUID(), signature };
      }
      const messageId = pending.current.id;
      let index = Math.max(
        session.nextSequence,
        (rows.at(-1)?.message.sequence ?? -1) + 1
      );
      for (let attempt = 0; ; attempt += 1) {
        const encrypted = await encryptMessage(
          sessionRoot,
          user.id,
          index,
          session.id,
          payload
        );
        try {
          await nativeChatRequest(conversationId, "incognito", options, {
            body: JSON.stringify({
              ...encrypted,
              id: messageId,
              keyEpoch: version,
              mediaIds: extractMessageReferences(payload).flatMap((ref) =>
                ref.kind === "media" && ref.requiredId ? [ref.requiredId] : []
              ),
              sessionId: session.id,
              viewOnceMediaIds:
                payload.type === "media" && "attachments" in payload
                  ? payload.attachments.flatMap((attachment) =>
                      attachment.kind === "view-once" ? [attachment.ref] : []
                    )
                  : [],
            }),
            method: "POST",
          });
          break;
        } catch (error) {
          if (
            error instanceof NativeChatControlError &&
            error.expectedIndex !== undefined &&
            attempt < 2
          ) {
            index = error.expectedIndex;
            continue;
          }
          throwChatError(error);
        }
      }
      entrances.register(messageId);
      pending.current = null;
      if (mounted.current) {
        setLatest(true);
        setLocalError(null);
        onRefresh();
      }
    } catch (error) {
      if (mounted.current) {
        setLocalError(
          error instanceof Error
            ? error.message
            : "Message couldn't be sent. Retry."
        );
        onRefresh();
      }
      throwChatError(error);
    }
  };
  const loadEarlier = async () => {
    const before = rows[0]?.message.sequence;
    if (before === undefined) {
      return;
    }
    setLatest(false);
    setLoading(true);
    // Leaving the thread aborts the read, so it never sets state on an
    // unmounted screen.
    earlierLoad.current?.abort();
    const controller = new AbortController();
    earlierLoad.current = controller;
    try {
      await load(controller.signal, before);
    } catch {
      if (!controller.signal.aborted && mounted.current) {
        setLocalError("Earlier messages couldn't be loaded. Retry.");
        setLoading(false);
      }
    }
  };
  useEffect(
    () => () => {
      earlierLoad.current?.abort();
    },
    []
  );
  const visibleRows = useMemo(
    () =>
      rows.filter(
        ({ message }) =>
          incognitoMessageExpiresAt(message) > clock + serverOffset
      ),
    [clock, rows, serverOffset]
  );
  const messages = useMemo(
    () => visibleRows.map(({ message }) => message),
    [visibleRows]
  );
  const peer = conversation?.members.find(
    (member) => member.userId !== user?.id
  )?.user;
  const groupMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getMessageGroupMeta>>();
    for (const [index, entry] of messages.entries()) {
      map.set(entry.id, getMessageGroupMeta(messages, index));
    }
    return map;
  }, [messages]);
  const handlePressImage = useCallback(
    (messageId: string, imageIndex: number) => {
      setViewer({ index: imageIndex, messageId });
    },
    []
  );
  const handleReactRow = useCallback(
    (messageId: string, emoji: string) => {
      void reactToMessage(messageId, emoji);
    },
    [reactToMessage]
  );
  const handleLongPressRow = useCallback((messageId: string) => {
    setReactionTarget(messageId);
  }, []);
  const renderRow = useCallback(
    ({ item: { message, payload } }: { item: Row }) => (
      <MemoIncognitoRow
        conversationId={conversationId}
        entrances={entrances}
        group={groupMap.get(message.id) ?? FALLBACK_GROUP}
        message={message}
        mine={message.senderId === user?.id}
        onCloseViewOnce={closeViewOnce}
        onLongPress={handleLongPressRow}
        onOpenViewOnce={openViewOnce}
        onPressImage={handlePressImage}
        onReact={handleReactRow}
        payload={payload}
        peerAvatarUrl={peer?.avatarUrl}
        width={width}
      />
    ),
    [
      closeViewOnce,
      conversationId,
      entrances,
      groupMap,
      handleLongPressRow,
      handlePressImage,
      handleReactRow,
      openViewOnce,
      peer?.avatarUrl,
      user?.id,
      width,
    ]
  );
  const viewed =
    canView && viewer
      ? visibleRows.find(({ message }) => message.id === viewer.messageId)
      : null;
  const viewedImages =
    viewed?.payload?.type === "media"
      ? getMediaImages(viewed.payload).map((image) => image.url)
      : [];
  return (
    <View style={{ flex: 1 }}>
      {(() => {
        if (canView) {
          if (loading && !rows.length) {
            return <ThreadSkeleton label="Opening incognito messages" />;
          }
          return (
            <FlatList
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              ref={list}
              data={visibleRows}
              keyExtractor={(row) => row.message.id}
              keyboardShouldPersistTaps="handled"
              {...LIST_VIRTUALIZATION_PROPS}
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              contentContainerStyle={{ flexGrow: 1, gap: 10, padding: 16 }}
              ListHeaderComponent={
                hasMore ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => {
                      void loadEarlier();
                    }}
                  >
                    <Text
                      style={{
                        color: "#a1a1aa",
                        padding: 12,
                        textAlign: "center",
                      }}
                    >
                      Load earlier messages
                    </Text>
                  </Pressable>
                ) : undefined
              }
              ListEmptyComponent={
                <View
                  style={{
                    alignItems: "center",
                    flex: 1,
                    gap: 12,
                    justifyContent: "center",
                  }}
                >
                  <Shield size={40} color="#71717a" />
                  <Text
                    style={{
                      color: "#f4f4f5",
                      fontFamily: "SofiaProBold",
                      fontSize: 18,
                    }}
                  >
                    No messages yet
                  </Text>
                </View>
              }
              renderItem={renderRow}
            />
          );
        }
        return (
          <View
            style={{
              alignItems: "center",
              flex: 1,
              gap: 12,
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Shield color="#71717a" size={36} />
            <Text style={{ color: "#d4d4d8", textAlign: "center" }}>
              Reconnect to continue chatting.
            </Text>
            <Pressable accessibilityRole="button" onPress={onRefresh}>
              <Text style={{ color: "#fff", padding: 12 }}>
                Retry connection
              </Text>
            </Pressable>
          </View>
        );
      })()}
      {latest ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setLatest(true);
            onRefresh();
          }}
        >
          <Text style={{ color: "#a1a1aa", padding: 10, textAlign: "center" }}>
            Return to latest messages
          </Text>
        </Pressable>
      )}
      {localError || lifecycleError ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRefresh}
          style={{ padding: 12 }}
        >
          <Text
            accessibilityRole="alert"
            style={{ color: "#fcd34d", textAlign: "center" }}
          >
            {localError ?? lifecycleError} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <MessageComposer
        conversationId={conversationId}
        stickersEnabled
        incognitoSessionId={session.id}
        disabled={!canView || busy}
        editing={null}
        onCancelEdit={() => {
          // No action is required here.
        }}
        onCancelReply={() => {
          // No action is required here.
        }}
        onSend={send}
        onTyping={() => {
          // No action is required here.
        }}
        replyTo={null}
        peerName="in incognito"
      />
      {viewedImages.length && viewer ? (
        <MessageMediaViewer
          ephemeral
          images={viewedImages}
          index={viewer.index}
          onClose={() => setViewer(null)}
        />
      ) : null}
      {reactionTarget ? (
        <MessageReactionSheet
          onClose={() => setReactionTarget(null)}
          onReact={(emoji) => {
            const target = reactionTarget;
            setReactionTarget(null);
            void reactToMessage(target, emoji);
          }}
        />
      ) : null}
    </View>
  );
}
