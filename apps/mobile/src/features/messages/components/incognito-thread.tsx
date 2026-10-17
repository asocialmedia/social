// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.
import {
  observeChatTask,
  throwChatError,
  incognitoMessageExpiresAt,
  extractMessageReferences,
} from "@asm/messages";
import type { IncognitoMessage, IncognitoSession } from "@asm/messages";
// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { randomUUID } from "expo-crypto";
import { Shield } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { getMediaImages } from "../lib/crypto";
import {
  getMessageGroupMeta,
  formatTimeDivider,
} from "../lib/message-grouping";
import type { MessageConversationData } from "../lib/types";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { MessageMediaViewer } from "./message-media-viewer";
import { MessageReactionSheet } from "./message-reaction-sheet";

interface Row {
  message: IncognitoMessage;
  payload: MessagePayload | null;
}
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
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      mounted.current = false;
      generation.current += 1;
      clearInterval(timer);
    };
  }, []);
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
    [conversationId, session.id, options, getBaseKeys, invalidateKeys]
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
    try {
      await load(new AbortController().signal, before);
    } catch {
      setLocalError("Earlier messages couldn't be loaded. Retry.");
      setLoading(false);
    }
  };
  const visibleRows = rows.filter(
    ({ message }) => incognitoMessageExpiresAt(message) > clock + serverOffset
  );
  const messages = visibleRows.map(({ message }) => message);
  const peer = conversation?.members.find(
    (member) => member.userId !== user?.id
  )?.user;
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
            return (
              <View style={{ flex: 1, justifyContent: "center" }}>
                <ActivityIndicator
                  color="#a1a1aa"
                  accessibilityLabel="Opening incognito messages"
                />
              </View>
            );
          }
          return (
            <FlatList
              ref={list}
              data={visibleRows}
              keyExtractor={(row) => row.message.id}
              keyboardShouldPersistTaps="handled"
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
                ) : null
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
              renderItem={({ item: { message, payload }, index }) => {
                const group = getMessageGroupMeta(messages, index);
                return (
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
                    <Pressable
                      onLongPress={() => setReactionTarget(message.id)}
                    >
                      <View>
                        <MessageBubble
                          ephemeral
                          deleted={false}
                          edited={false}
                          group={group}
                          mine={message.senderId === user?.id}
                          payload={payload}
                          failed={!payload}
                          peerAvatarUrl={peer?.avatarUrl}
                          theme={{
                            from: "#71717a",
                            key: "incognito",
                            label: "Incognito",
                            ring: "#a1a1aa",
                            to: "#52525b",
                          }}
                          maxBubbleWidth={width - 32}
                          showReceipt={false}
                          onPressImage={(imageIndex) =>
                            setViewer({
                              index: imageIndex,
                              messageId: message.id,
                            })
                          }
                          onOpenViewOnce={openViewOnce}
                          onCloseViewOnce={closeViewOnce}
                          onReact={(emoji) => {
                            void reactToMessage(message.id, emoji);
                          }}
                          reactions={message.reactions ?? []}
                        />
                      </View>
                    </Pressable>
                  </View>
                );
              }}
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
